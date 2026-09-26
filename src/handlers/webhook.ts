import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import { getD1, D1Database } from '../db/client';
import { TransactionRecord } from '../db/queries';
import { SlipExtractionResult } from '../services/vision';
import { downloadMessageImage, replyLineMessage, showLoadingAnimation } from '../services/line';
import { extractSlipInfo } from '../services/vision';
import {
  createTransaction,
  getCategorySummary,
  getGroupMemberSummary,
  upsertUser,
  upsertGroup,
  getCachedExtraction,
  saveExtractionCache,
  findDuplicateSlip,
  getTransactionById,
  claimMessage,
  recordSlipParties
} from '../db/queries';
import { findCategoryRule, updateTransaction, upsertContact, findContact, loadDirectionMemory, unlearnSelf } from '../db/liff';
import { decideDirection, isInternalTransfer, bkkToday, emptyMemory, MemorySnapshot, DirectionVerdict } from '../services/direction';
import { logEvent } from '../db/events';
import {
  hashUserId,
  newRequestId,
  startRequest,
  finishRequest,
  setSlipStage,
  logStage,
  cleanupOldSlipTracking
} from '../observability/log';
import { countCorrectionsFor } from '../db/metrics';
import {
  createAutoSavedFlex,
  createSummaryFlex,
  createDuplicateSlipFlex
} from '../templates/flex';

const EXPENSE_CATEGORIES = ['อาหารและเครื่องดื่ม', 'การเดินทาง', 'ของใช้ทั่วไป', 'บิลและสาธารณูปโภค', 'อื่นๆ'];
const INCOME_CATEGORIES = ['เงินเดือน', 'ขายของ', 'รายรับทั่วไป', 'อื่นๆ'];

/**
 * Normalizes the LLM's category guess into our fixed category list.
 * Tries an exact/substring match first, then falls back to "อื่นๆ".
 */
function normalizeCategory(raw: string | null, type: 'income' | 'expense'): string {
  const allowed = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (raw) {
    const exact = allowed.find(c => c === raw.trim());
    if (exact) return exact;
    const loose = allowed.find(c => raw.includes(c) || c.includes(raw.trim()));
    if (loose) return loose;
    // Common synonyms the model might produce
    const synonyms: Record<string, string> = {
      'อาหาร': 'อาหารและเครื่องดื่ม', 'เดินทาง': 'การเดินทาง', 'ของใช้': 'ของใช้ทั่วไป',
      'บิล': 'บิลและสาธารณูปโภค', 'ค่าใช้จ่ายประจำ': 'บิลและสาธารณูปโภค'
    };
    for (const [key, value] of Object.entries(synonyms)) {
      if (raw.includes(key) && allowed.includes(value)) return value;
    }
  }
  return 'อื่นๆ';
}

/** Observability for the batch assumption: a lookalike slip seconds later was auto-saved. */
function tryLogDupBatchAutoSaved(db: D1Database | null, requestId: string, duplicateOf: string | undefined): void {
  logStage(db, requestId, 'dup_recent_batch_autosaved', { duplicate_of: duplicateOf });
  console.log(`[Slip Detection] Lookalike of ${duplicateOf} within batch window — auto-saving as a new payment.`);
}

/**
 * Category for a parsed slip, in priority order:
 *   1. a rule the user taught via LIFF
 *   2. contact memory — the category last used with this counterparty
 *   3. the rule-based/LLM category guess
 */
async function resolveSlipCategory(
  db: D1Database,
  userId: string,
  merchant: string | null,
  rawCategory: string | null,
  type: 'income' | 'expense'
): Promise<string> {
  if (merchant) {
    const rule = await findCategoryRule(db, merchant).catch(() => null);
    if (rule && rule.type === type) return rule.category;
    const contact = await findContact(db, userId, merchant, type).catch(() => null);
    if (contact && contact.type === type) return contact.category;
  }
  return normalizeCategory(rawCategory, type);
}

/**
 * Persists a parsed slip as a transaction. Shared by the auto-save pipeline
 * and the "บันทึกอยู่ดี" postback on the duplicate-warning card. Every saved
 * slip also updates the counterparty memory (contact_names).
 */
async function saveSlipFromExtraction(
  db: D1Database,
  userId: string,
  groupId: string | null,
  extraction: SlipExtractionResult,
  precomputedCategory?: string,
  learnSelf = false   // true เฉพาะเมื่อ verdict.learnable หรือผู้ใช้กดแก้ (ground truth)
): Promise<TransactionRecord> {
  if (extraction.amount === null || extraction.amount === undefined) {
    throw new Error('slip amount missing');
  }
  const txType: 'income' | 'expense' = extraction.direction === 'income' ? 'income' : 'expense';
  const category = precomputedCategory ?? (await resolveSlipCategory(db, userId, extraction.merchant, extraction.category, txType));
  const txDate = extraction.date || bkkToday();
  const saved = await createTransaction(db, {
    line_user_id: userId,
    line_group_id: groupId,
    amount: extraction.amount,
    type: txType,
    category,
    merchant: extraction.merchant,
    date: txDate
  });
  if (saved.id) {
    // Learn the owner's identifiers (printed names AND account-tail signatures)
    // ONLY from provable verdicts or user corrections — keyword/default guesses
    // must never poison the self registry (v1's memory-poison bug).
    if (learnSelf) {
      if (txType === 'expense') {
        for (const t of extraction.party_from_tails || []) {
          await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
        }
        if (extraction.party_from) {
          await upsertContact(db, userId, extraction.party_from, 'self', null).catch(() => {});
        }
      } else {
        for (const t of extraction.party_to_tails || []) {
          await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
        }
        if (extraction.party_to) {
          await upsertContact(db, userId, extraction.party_to, 'self', null).catch(() => {});
        }
      }
    }
    if (extraction.merchant) {
      await upsertContact(db, userId, extraction.merchant, txType, category).catch(() => {});
    }
    await recordSlipParties(db, userId, saved.id,
      extraction.party_from ?? null, extraction.party_to ?? null,
      extraction.party_from_tails || [], extraction.party_to_tails || []
    ).catch(() => {});
  }
  return saved;
}

/**
 * Validates the LINE webhook signature using HMAC-SHA256
 */
export function verifySignature(rawBody: Buffer | string, signature: string): boolean {
  if (!config.line.channelSecret || !signature) {
    return false;
  }
  try {
    const hash = crypto
      .createHmac('SHA256', config.line.channelSecret)
      .update(rawBody)
      .digest('base64');

    const hashBuffer = Buffer.from(hash);
    const signatureBuffer = Buffer.from(signature);

    if (hashBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(hashBuffer, signatureBuffer);
  } catch {
    return false;
  }
}

/**
 * Webhook handler for LINE Messaging API
 */
export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['x-line-signature'] as string;
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

  if (!signature || !verifySignature(rawBody, signature)) {
    console.warn('[Webhook] Invalid or missing signature');
    try {
      logEvent(getD1(), 'warn', 'system', 'signature_invalid', 'express: invalid or missing x-line-signature');
    } catch {
      /* DB not bound — skip */
    }
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const events: any[] = req.body?.events || [];

  // Respond 200 OK immediately to LINE to prevent timeouts during Render cold-starts or LLM analysis
  res.status(200).json({ status: 'ok', processed: events.length });

  // Process events asynchronously in the background
  for (const event of events) {
    processWebhookEvent(event).catch(err => {
      console.error('[Webhook Background] Error processing event:', err);
    });
  }
}

/**
 * Process a single LINE webhook event.
 * Every event gets a correlation ID (requestId) shared by its request_logs
 * row, its pending_slips checkpoint and every system_events line it emits.
 */
export async function processWebhookEvent(event: any): Promise<void> {
  const sourceType = event.source?.type;
  const userId = event.source?.userId;
  const groupId = event.source?.groupId || event.source?.roomId || null;
  const requestId = newRequestId(event);
  const eventType = `message.${event.message?.type || 'unknown'}`;
  const t0 = Date.now();

  // Try to bind the DB, but never let observability break processing
  let db: ReturnType<typeof getD1> | null = null;
  try {
    db = getD1();
  } catch {
    db = null;
  }

  const source = sourceType === 'user' ? `user:${hashUserId(userId)}` : sourceType;
  console.log(`[Event] id=${requestId} type: ${event.type}, source: ${source}, groupId: ${groupId}`);

  startRequest(db, {
    requestId,
    eventType: event.type === 'message' ? eventType : event.type,
    messageId: event.message?.id,
    userId,
    groupId
  });

  try {
    // Auto-record user if userId is present
    if (userId) {
      try {
        const db2 = getD1();
        await upsertUser(db2, { line_user_id: userId });
        if (groupId) {
          await upsertGroup(db2, { line_group_id: groupId });
        }
      } catch (e) {
        console.warn('[DB Auto-record] Failed to record user/group:', e);
      }
    }

    // 1. Handle incoming messages
    if (event.type === 'message') {
      const message = event.message;

      // Image message -> Check slip with Vision LLM
      if (message.type === 'image') {
        await handleImageMessage(event, userId, groupId, requestId, t0);
      }
      // Text message -> Commands (สรุป, ตั้งชื่อ)
      else if (message.type === 'text') {
        await handleTextMessage(event, userId, groupId, requestId);
      }
    }
    // 2. Handle Postback — type toggle on the auto-saved card and the
    // save/skip buttons on the duplicate-slip warning card.
    else if (event.type === 'postback') {
      await handlePostback(event, userId, requestId, t0);
    }

    await finishRequest(db, requestId, 'success', Date.now() - t0);
    cleanupOldSlipTracking(db);
  } catch (err: any) {
    await finishRequest(db, requestId, 'failed', Date.now() - t0, err?.message || String(err));
    throw err;
  }
}

/**
 * Handles incoming slip images — the pipeline is
 * received → downloading → extracting → extracted → saving → saved → replied,
 * each step checkpointed in pending_slips and logged under one requestId.
 */
async function handleImageMessage(
  event: any,
  userId: string,
  groupId: string | null,
  requestId: string,
  requestStart: number
) {
  const messageId = event.message.id;
  const replyToken = event.replyToken;

  // Awaited so a checkpoint is never dropped by the Workers runtime after the
  // handler settles — a lost write would leave the slip stuck 'pending'.
  const markStage = async (stage: 'received' | 'downloading' | 'extracting' | 'extracted' | 'saving' | 'saved' | 'replied' | 'not_slip') =>
    setSlipStage(db, messageId, stage, 'pending', userId);

  // Multiple slips sent in a burst each arrive as their own event and are
  // processed in parallel (see webhookHandler). LINE may also redeliver a
  // message if the webhook response is slow — skip anything already handled.
  let db: ReturnType<typeof getD1> | null = null;
  try {
    db = getD1();
  } catch {
    db = null;
  }

  if (db) {
    // Old-format rows from v1 (a real cached extraction) still short-circuit;
    // a fresh claim '{}' within 10 min means a concurrent twin is processing.
    const seen = await getCachedExtraction(db, `msg:${messageId}`).catch(() => null);
    if (seen && seen.is_slip !== undefined) {
      console.log(`[Slip Detection] Message ${messageId} already processed. Skipping duplicate.`);
      await finishRequest(db, requestId, 'ignored', Date.now() - requestStart, 'duplicate');
      return;
    }
    const claimed = await claimMessage(db, messageId).catch(() => true);
    if (!claimed) {
      console.log(`[Slip Detection] Message ${messageId} is being processed concurrently. Skipping.`);
      await finishRequest(db, requestId, 'ignored', Date.now() - requestStart, 'concurrent');
      return;
    }
  }

  await markStage('received');
  const targetChatId = groupId || userId;
  if (targetChatId) {
    await showLoadingAnimation(targetChatId, 20); // max 20 seconds loading animation
  }

  console.log(`[Slip Detection] [${requestId}] Downloading image for message: ${messageId}`);
  await markStage('downloading');
  const imageBuffer = await downloadMessageImage(messageId);

  await markStage('extracting');
  // Identical slip images resolve instantly from cache instead of calling the LLM again.
  // A cache hit also means this exact photo was sent before — a strong duplicate signal.
  // v2 prefix: old entries (without party_from/party_to) must not shadow the
  // new pipeline during their 24h TTL.
  const imageHash = `img2:${crypto.createHash('sha256').update(imageBuffer).digest('hex')}`;
  const cachedHit = db ? await getCachedExtraction(db, imageHash).catch(() => null) : null;
  const imageReplay = Boolean(cachedHit);
  let extraction: SlipExtractionResult | null = cachedHit;
  if (cachedHit) {
    logEvent(db, 'info', 'ai', 'gemini_cache_hit', imageHash.slice(0, 20));
    console.log('[Slip Detection] Extraction served from cache.');
  } else {
    try {
      const t0 = Date.now();
      extraction = await extractSlipInfo(imageBuffer);
      // Metadata only — never log merchant names / account details (PDPA)
      logEvent(db, 'info', 'ai', 'gemini_call_ok', null, {
        requestId,
        latencyMs: Date.now() - t0,
        data: {
          model: config.gemini.model,
          is_slip: extraction.is_slip,
          direction: extraction.direction,
          confidence: extraction.confidence,
          has_amount: extraction.amount !== null,
          has_date: extraction.date !== null,
          has_merchant: extraction.merchant !== null,
          ocr_assisted: Boolean(config.typhoon.apiKey)
        }
      });
    } catch (err: any) {
      logEvent(db, 'error', 'ai', 'gemini_call_fail', String(err?.message || err).slice(0, 300), { requestId });
      throw err;
    }
    if (db && extraction.is_slip) {
      await saveExtractionCache(db, imageHash, extraction).catch(() => {});
    }
  }

  if (!extraction) {
    // Unreachable: both branches above assign a result
    throw new Error('slip extraction missing');
  }

  // Mark the message as handled so redeliveries are skipped
  if (db) {
    await saveExtractionCache(db, `msg:${messageId}`, extraction).catch(() => {});
  }

  // Rule 1: same name printed on both sides (จาก = ถึง) → own-account transfer.
  // v2: exact normalized equality or a shared account tail — similar names alone
  // no longer skip (father→son false positives).
  if (extraction.party_from && extraction.party_to &&
      isInternalTransfer(extraction.party_from, extraction.party_to,
        extraction.party_from_tails || [], extraction.party_to_tails || [])) {
    await setSlipStage(db, messageId, 'skipped', 'done', userId);
    logStage(db, requestId, 'internal_transfer', { party: hashUserId(extraction.party_from) });
    console.log(`[Slip Detection] [${requestId}] Internal transfer — not saved.`);
    if (!groupId) {
      await replyLineMessage(replyToken, [
        {
          type: 'text',
          text: 'รายการนี้เป็นการโอนเข้าบัญชีตัวเอง (โอนข้ามบัญชี) จึงไม่บันทึกเป็นรายรับหรือรายจ่ายครับ'
        }
      ]).catch(() => {});
    }
    await finishRequest(db, requestId, 'ignored', Date.now() - requestStart, 'internal_transfer');
    return;
  }

  // Rule 2: direction ladder v2 — memory first, keyword only as a weak fallback.
  let verdict: DirectionVerdict | null = null;
  if (db) {
    const keywordDirection = extraction.direction;
    const snapshot: MemorySnapshot = await loadDirectionMemory(db, userId).catch(() => emptyMemory());
    verdict = decideDirection({
      amount: extraction.amount ?? 0,
      keywordDirection,
      partyFrom: extraction.party_from ?? null,
      partyTo: extraction.party_to ?? null,
      fromTails: extraction.party_from_tails || [],
      toTails: extraction.party_to_tails || []
    }, snapshot);
    extraction.direction = verdict.direction;
    if (verdict.counterparty) extraction.merchant = verdict.counterparty;
    // Record which rule decided — the direction-accuracy panel aggregates this
    extraction.direction_rule = verdict.rule;
    // Re-resolve the category only when the ladder changed the type — the
    // LLM's category is still valid when the direction agrees with its guess.
    if (verdict.direction !== keywordDirection) extraction.category = null;
  }
  await markStage('extracted');
  console.log('[Slip Detection] Vision Result:', extraction);
  // If not a slip, stay completely silent (especially in groups)
  if (!extraction.is_slip || extraction.amount === null) {
    await setSlipStage(db, messageId, 'not_slip', 'done', userId);
    logStage(db, requestId, 'not_slip', { confidence: extraction.confidence });
    await finishRequest(db, requestId, 'ignored', Date.now() - requestStart, 'not_slip');
    console.log('[Slip Detection] Image is not a recognized slip. Staying silent.');
    return;
  }

  const todayStr = bkkToday();
  const txDate = extraction.date || todayStr;
  const txType: 'income' | 'expense' = extraction.direction === 'income' ? 'income' : 'expense';

  // Category priority: a rule the user taught via LIFF > the LLM's guess > "อื่นๆ"
  const saveDb = db ?? getD1();
  const category = await resolveSlipCategory(saveDb, userId, extraction.merchant, extraction.category, txType);

  // Content-based dedup: same user + type + amount + date + merchant already
  // saved means this is very likely the same slip sent again (re-screenshot,
  // forward, re-upload). Ask instead of silently double-booking.
  if (db) {
    const dup = await findDuplicateSlip(saveDb, {
      userId,
      amount: extraction.amount,
      type: txType,
      date: txDate,
      merchant: extraction.merchant
    }).catch(() => null);
    if (dup) {
      // Album/batch support: several photos sent together may legitimately be
      // identical-looking payments (e.g. two 84-baht fares same day). If the
      // matching transaction was saved seconds ago AND this is a different
      // photo, treat it as the next slip in the batch and auto-save. A re-sent
      // identical photo (cache hit) still gets the confirmation card.
      const recentBatch = dup.age_seconds !== null && dup.age_seconds < 120;
      if (recentBatch && !imageReplay) {
        tryLogDupBatchAutoSaved(db, requestId, dup.id);
      } else {
        await setSlipStage(db, messageId, 'awaiting_confirm', 'pending', userId);
        logStage(db, requestId, 'duplicate_detected', { duplicate_of: dup.id });
        console.log(`[Slip Detection] Duplicate content of transaction ${dup.id} — asking user to confirm.`);
        try {
          await replyLineMessage(replyToken, [
            createDuplicateSlipFlex({
              existing: {
                amount: dup.amount,
                type: dup.type,
                category: dup.category ?? 'อื่นๆ',
                merchant: dup.merchant ?? null,
                date: dup.date
              },
              incoming: {
                amount: extraction.amount,
                type: txType,
                category,
                merchant: extraction.merchant,
                date: txDate
              },
              messageId
            })
          ]);
        } finally {
          await finishRequest(db, requestId, 'ignored', Date.now() - requestStart, 'duplicate_slip');
        }
        return;
      }
    }
  }

  // Auto-save immediately — no category picker, no user interaction required
  await markStage('saving');
  const saved = await saveSlipFromExtraction(saveDb, userId, groupId, extraction, category, verdict?.learnable ?? false);
  await setSlipStage(db, messageId, 'saved', 'done', userId);
  console.log(`[Slip Detection] Auto-saved: ${saved.type} ฿${saved.amount} [${saved.category}]`);
  logStage(db, requestId, 'slip_saved', {
    type: saved.type,
    amount: saved.amount,
    category: saved.category,
    confidence: extraction.confidence,
    rule: extraction.direction_rule ?? null
  });
  logEvent(db, 'info', 'bot', 'slip_saved', `${saved.type} ฿${saved.amount} [${saved.category}] user=${hashUserId(userId)}${groupId ? ` in ${groupId}` : ''}`);

  const flexMessage = createAutoSavedFlex({
    amount: saved.amount,
    merchant: saved.merchant ?? null,
    date: saved.date,
    type: saved.type,
    category: saved.category ?? 'อื่นๆ',
    txId: saved.id,
    messageId
  });

  try {
    await replyLineMessage(replyToken, [flexMessage]);
    await setSlipStage(db, messageId, 'replied', 'done', userId);
    logStage(db, requestId, 'replied');
  } catch (err: any) {
    // reply_ok/reply_fail are logged by the LINE service itself; the slip is
    // already saved, so mark the checkpoint done but flag the outcome
    await setSlipStage(db, messageId, 'replied', 'done', userId);
    await finishRequest(db, requestId, 'failed', Date.now() - requestStart, `reply_failed: ${err?.message || err}`);
    throw err;
  }
}

/**
 * Handles text commands like "สรุป" and "ชื่อ [ชื่อเล่น]"
 */
async function handleTextMessage(
  event: any,
  userId: string,
  groupId: string | null,
  requestId: string
) {
  const text = (event.message.text || '').trim();
  const replyToken = event.replyToken;

  // Command: register the account owner's ACCOUNT NUMBER — the strongest
  // direction signal (normalized to its last 4 digits, matching slip masks).
  const accountNoMatch = text.match(/^(?:เลขบัญชี|เลขบัญชีธนาคาร)\s+([0-9xX×*\-\s]{4,})$/i);
  if (accountNoMatch && userId) {
    const digits = accountNoMatch[1].replace(/\D/g, '');
    if (digits.length < 4) {
      await replyLineMessage(replyToken, [{ type: 'text', text: 'เลขบัญชีต้องมีอย่างน้อย 4 หลักครับ' }]);
      return;
    }
    const tail = digits.slice(-4);
    const dbCmd = getD1();
    await upsertContact(dbCmd, userId, 'acc:' + tail, 'self', null).catch(() => {});
    await replyLineMessage(replyToken, [
      { type: 'text', text: `จดจำเลขบัญชีที่ลงท้าย ${tail} แล้วครับ ✅\nสลิปที่เลขนี้อยู่ฝั่ง "ถึง" = รายรับ ฝั่ง "จาก" = รายจ่าย — ลงทะเบียนได้หลายบัญชี` }
    ]);
    return;
  }

  // Command: register the account owner's printed name — the strongest signal
  // for income/expense direction ("ถึง <ชื่อนี้>" = money coming in).
  const accountMatch = text.match(/^(?:ชื่อบัญชี|บัญชีชื่อ)\s+(.+)$/i);
  if (accountMatch && userId) {
    const name = accountMatch[1].trim().slice(0, 60);
    const dbCmd = getD1();
    await upsertContact(dbCmd, userId, name, 'self', null).catch(() => {});
    await upsertUser(dbCmd, { line_user_id: userId, nickname: name }).catch(() => {});
    await replyLineMessage(replyToken, [
      { type: 'text', text: `จดจำชื่อบัญชี "${name}" แล้วครับ ✅\nสลิปที่มีชื่อนี้อยู่ฝั่ง "ถึง" จะถูกบันทึกเป็นรายรับ และฝั่ง "จาก" เป็นรายจ่าย\nลงทะเบียนได้หลายชื่อ — พิมพ์ ชื่อบัญชี <ชื่ออื่น> เพิ่มได้เลย` }
    ]);
    return;
  }

  // Command: Set Nickname
  const nameMatch = text.match(/^(?:ชื่อ|name)\s+(.+)$/i);
  if (nameMatch && userId) {
    const nickname = nameMatch[1].trim();
    const db = getD1();
    await upsertUser(db, { line_user_id: userId, nickname });

    await replyLineMessage(replyToken, [
      {
        type: 'text',
        text: `✅ บันทึกชื่อของคุณเป็น "${nickname}" เรียบร้อยแล้วครับ!`
      }
    ]);
    return;
  }

  // Command: Summary ("สรุป")
  if (/^(สรุป|ยอด|summary)$/i.test(text)) {
    const db = getD1();
    const now = new Date();
    // Default to current month
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const categorySummary = await getCategorySummary(db, {
      userId: groupId ? undefined : userId,
      groupId: groupId || undefined,
      startDate: startOfMonth,
      endDate: endOfMonth
    });

    const totalExpense = categorySummary
      .filter(item => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.total_amount), 0);

    const totalIncome = categorySummary
      .filter(item => item.type === 'income')
      .reduce((sum, item) => sum + Number(item.total_amount), 0);

    let memberBreakdown: { nickname: string; total_paid: number; transaction_count: number }[] | undefined;

    if (groupId) {
      memberBreakdown = await getGroupMemberSummary(db, {
        groupId,
        startDate: startOfMonth,
        endDate: endOfMonth
      });
    }

    const monthNames = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const currentMonthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear() + 543}`;

    const summaryFlex = createSummaryFlex({
      periodLabel: currentMonthLabel,
      totalExpense,
      totalIncome,
      // Only expense rows belong in the expense category breakdown; income is shown separately
      categoryBreakdown: categorySummary.filter(item => item.type === 'expense'),
      memberBreakdown
    });

    await replyLineMessage(replyToken, [summaryFlex]);
  }
}

/**
 * Handles postback actions from the bot's own Flex cards:
 *   act=toggle_type&tx=<id> — flip a saved transaction income <-> expense
 *   act=dup_save&msg=<messageId> — confirm saving a suspected-duplicate slip
 *   act=dup_skip&msg=<messageId> — dismiss the duplicate warning
 */
async function handlePostback(
  event: any,
  userId: string | undefined,
  requestId: string,
  requestStart: number
) {
  const params = new URLSearchParams(String(event.postback?.data || ''));
  const act = params.get('act');
  if (!act) return; // unknown/legacy postback — nothing to do

  const replyToken = event.replyToken;
  const db = getD1();
  const groupId = event.source?.groupId || event.source?.roomId || null;

  try {
    if (act === 'toggle_type' || act === 'set_type') {
      const txId = params.get('tx') || '';
      if (!userId || !txId) {
        await replyLineMessage(replyToken, [{ type: 'text', text: 'ใช้ปุ่มนี้ไม่ได้ในบริบทนี้ครับ' }]);
        return;
      }
      const tx = await getTransactionById(db, userId, txId);
      if (!tx) {
        await replyLineMessage(replyToken, [{ type: 'text', text: 'ไม่พบรายการนี้ หรือไม่ใช่รายการของคุณครับ' }]);
        return;
      }
      // set_type fixes to the tapped direction; legacy toggle_type flips
      const newType: 'income' | 'expense' = act === 'set_type'
        ? (params.get('t') === 'income' ? 'income' : 'expense')
        : (tx.type === 'income' ? 'expense' : 'income');
      const txCategory = tx.category ?? 'อื่นๆ';
      const fields: { type: 'income' | 'expense'; category?: string } = { type: newType };
      // Keep the category plausible for the new type
      if (newType === 'income' && !INCOME_CATEGORIES.includes(txCategory)) fields.category = 'รายรับทั่วไป';
      if (newType === 'expense' && !EXPENSE_CATEGORIES.includes(txCategory)) fields.category = 'อื่นๆ';
      await updateTransaction(db, userId, txId, fields);
      // Teach the memory from every correction: the slip's printed parties map
      // to self/payer/payee roles according to the user's verdict.
      const msgId = params.get('msg') || '';
      if (msgId) {
        const extraction = await getCachedExtraction(db, `msg:${msgId}`).catch(() => null);
        if (extraction && extraction.is_slip) {
          // Ground truth from the user: anything the wrong guess taught as 'self'
          // on the now-disproven side must be unlearned, not just overridden.
          if (newType === 'income') {
            await unlearnSelf(db, userId, [extraction.party_from ?? ''], extraction.party_from_tails || []);
          } else {
            await unlearnSelf(db, userId, [extraction.party_to ?? ''], extraction.party_to_tails || []);
          }
          const finalCategory = fields.category ?? txCategory;
          if (newType === 'income') {
            for (const t of extraction.party_to_tails || []) {
              await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
            }
            if (extraction.party_to) await upsertContact(db, userId, extraction.party_to, 'self', null).catch(() => {});
            if (extraction.party_from) await upsertContact(db, userId, extraction.party_from, 'income', finalCategory).catch(() => {});
          } else {
            for (const t of extraction.party_from_tails || []) {
              await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
            }
            if (extraction.party_from) await upsertContact(db, userId, extraction.party_from, 'self', null).catch(() => {});
            if (extraction.party_to) await upsertContact(db, userId, extraction.party_to, 'expense', finalCategory).catch(() => {});
          }
        }
      }
      // Re-send the saved card so the user sees the flip with the right color
      // (green for income, red for expense) and can toggle again if needed.
      const newCategory = fields.category ?? tx.category ?? 'อื่นๆ';
      // Accuracy analytics: log which engine rule the user just overruled, and
      // nudge registration when the same counterparty keeps getting corrected.
      let nudge: string | null = null;
      if (newType !== tx.type) {
        const rule = (await getCachedExtraction(db, `msg:${msgId || 'x'}`).catch(() => null))?.direction_rule ?? null;
        logEvent(db, 'info', 'bot', 'direction_correction', null, {
          requestId,
          data: { rule, from: tx.type, to: newType, name: tx.merchant ?? null }
        });
        if (await countCorrectionsFor(db, tx.merchant ?? '', 30) >= 2) {
          nudge = 'ชื่อ/เลขนี้ถูกแก้ทิศทางบ่อย — พิมพ์ "ชื่อบัญชี <ชื่อ>" หรือ "เลขบัญชี <เลข>" เพื่อยืนยันตัวตนของคุณ ระบบจะแม่นขึ้นทันที';
        }
      }
      const replyMessages: any[] = [
        createAutoSavedFlex({
          amount: tx.amount,
          merchant: tx.merchant ?? null,
          date: tx.date,
          type: newType,
          category: newCategory,
          txId: tx.id,
          messageId: msgId || null
        })
      ];
      if (nudge) replyMessages.push({ type: 'text', text: nudge });
      await replyLineMessage(replyToken, replyMessages);
      return;
    }

    if (act === 'confirm_type') {
      const msgId = params.get('msg') || '';
      const newType: 'income' | 'expense' = params.get('t') === 'income' ? 'income' : 'expense';
      if (!userId || !msgId) {
        await replyLineMessage(replyToken, [{ type: 'text', text: 'ใช้ปุ่มนี้ไม่ได้ในบริบทนี้ครับ' }]);
        return;
      }
      const extraction = await getCachedExtraction(db, `msg:${msgId}`);
      if (!extraction || !extraction.is_slip || extraction.amount === null) {
        await setSlipStage(db, msgId, 'extracted', 'failed', userId);
        await replyLineMessage(replyToken, [
          { type: 'text', text: 'หมดอายุการยืนยันแล้ว ส่งสลิปมาใหม่ได้เลยครับ' }
        ]);
        return;
      }
      // Double-tap guard — the first tap already wrote the row
      const doneMarker = await getCachedExtraction(db, `saved:${msgId}`).catch(() => null);
      if (doneMarker) {
        await replyLineMessage(replyToken, [{ type: 'text', text: 'รายการนี้บันทึกไปแล้วครับ' }]);
        return;
      }
      await saveExtractionCache(db, `saved:${msgId}`, extraction).catch(() => {});

      // Ground truth from the user: unlearn the disproven side's self rows first.
      if (newType === 'income') {
        await unlearnSelf(db, userId, [extraction.party_from ?? ''], extraction.party_from_tails || []);
      } else {
        await unlearnSelf(db, userId, [extraction.party_to ?? ''], extraction.party_to_tails || []);
      }

      // The user's verdict IS the ground truth — apply it and teach the memory
      extraction.direction = newType;
      if (newType === 'income' && extraction.party_from) extraction.merchant = extraction.party_from;
      if (newType === 'expense' && extraction.party_to) extraction.merchant = extraction.party_to;
      const saved = await saveSlipFromExtraction(db, userId, groupId, extraction);
      await setSlipStage(db, msgId, 'saved', 'done', userId);
      logEvent(db, 'info', 'bot', 'direction_correction', null, {
        requestId,
        data: { rule: extraction.direction_rule ?? null, from: 'unconfirmed', to: newType, name: saved.merchant ?? null }
      });
      if (newType === 'income') {
        for (const t of extraction.party_to_tails || []) {
          await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
        }
        if (extraction.party_to) await upsertContact(db, userId, extraction.party_to, 'self', null).catch(() => {});
      } else {
        for (const t of extraction.party_from_tails || []) {
          await upsertContact(db, userId, 'acc:' + t, 'self', null).catch(() => {});
        }
        if (extraction.party_from) await upsertContact(db, userId, extraction.party_from, 'self', null).catch(() => {});
      }
      await replyLineMessage(replyToken, [
        createAutoSavedFlex({
          amount: saved.amount,
          merchant: saved.merchant ?? null,
          date: saved.date,
          type: saved.type,
          category: saved.category ?? 'อื่นๆ',
          txId: saved.id,
          messageId: msgId
        })
      ]);
      return;
    }

    if (act === 'dup_save' || act === 'dup_skip') {
      const msgId = params.get('msg') || '';
      if (!userId || !msgId) {
        await replyLineMessage(replyToken, [{ type: 'text', text: 'ใช้ปุ่มนี้ไม่ได้ในบริบทนี้ครับ' }]);
        return;
      }

      if (act === 'dup_skip') {
        await setSlipStage(db, msgId, 'skipped', 'done', userId);
        await replyLineMessage(replyToken, [{ type: 'text', text: 'ไม่บันทึกรายการซ้ำให้ครับ' }]);
        return;
      }

      // dup_save — the extraction is cached under the message id during the
      // original pipeline; a second tap hits the content dedup and is refused.
      const extraction = await getCachedExtraction(db, `msg:${msgId}`);
      if (!extraction || !extraction.is_slip || extraction.amount === null) {
        await setSlipStage(db, msgId, 'extracted', 'failed', userId);
        await replyLineMessage(replyToken, [
          { type: 'text', text: 'หมดอายุการยืนยันแล้ว ส่งสลิปมาใหม่ได้เลยครับ' }
        ]);
        return;
      }
      const dup = await findDuplicateSlip(db, {
        userId,
        amount: extraction.amount,
        type: extraction.direction === 'income' ? 'income' : 'expense',
        date: extraction.date || bkkToday(),
        merchant: extraction.merchant
      }).catch(() => null);
      if (dup) {
        await setSlipStage(db, msgId, 'saved', 'done', userId);
        await replyLineMessage(replyToken, [
          { type: 'text', text: `รายการนี้บันทึกไว้แล้วครับ (${dup.type === 'income' ? '+' : '−'}฿${dup.amount.toLocaleString()} · ${dup.category})` }]
        );
        return;
      }
      const saved = await saveSlipFromExtraction(db, userId, groupId, extraction);
      await setSlipStage(db, msgId, 'saved', 'done', userId);
      await replyLineMessage(replyToken, [
        createAutoSavedFlex({
          amount: saved.amount,
          merchant: saved.merchant ?? null,
          date: saved.date,
          type: saved.type,
          category: saved.category ?? 'อื่นๆ',
          txId: saved.id
        })
      ]);
      return;
    }
  } finally {
    await finishRequest(db, requestId, 'success', Date.now() - requestStart);
  }
}
