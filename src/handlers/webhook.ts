import { Request, Response } from 'express';
import crypto from 'crypto';
import { config } from '../config/env';
import { downloadMessageImage, replyLineMessage, showLoadingAnimation } from '../services/line';
import { extractSlipInfo } from '../services/vision';
import { getD1 } from '../db/client';
import {
  createTransaction,
  getCategorySummary,
  getGroupMemberSummary,
  upsertUser,
  upsertGroup,
  getCachedExtraction,
  saveExtractionCache
} from '../db/queries';
import { findCategoryRule } from '../db/liff';
import {
  createAutoSavedFlex,
  createSummaryFlex
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
 * Process a single LINE webhook event
 */
export async function processWebhookEvent(event: any): Promise<void> {
  const sourceType = event.source?.type;
  const userId = event.source?.userId;
  const groupId = event.source?.groupId || event.source?.roomId || null;

  console.log(`[Event] type: ${event.type}, source: ${sourceType}, userId: ${userId}, groupId: ${groupId}`);

  if (sourceType === 'user') {
    console.log(`[Mode: 1-on-1 Chat] Handling event for direct user: ${userId}`);
  } else if (sourceType === 'group' || sourceType === 'room') {
    console.log(`[Mode: Group/Room] Handling event in group: ${groupId} from user: ${userId}`);
  }

  // Auto-record user if userId is present
  if (userId) {
    try {
      const db = getD1();
      await upsertUser(db, { line_user_id: userId });
      if (groupId) {
        await upsertGroup(db, { line_group_id: groupId });
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
      await handleImageMessage(event, userId, groupId);
    }
    // Text message -> Commands (สรุป, ตั้งชื่อ)
    else if (message.type === 'text') {
      await handleTextMessage(event, userId, groupId);
    }
  }
  // 2. Handle Postback — kept as a no-op: the bot now auto-saves slips, so no
  // interactive postback cards are sent anymore (legacy clients may still send events).
  else if (event.type === 'postback') {
    // nothing to do
  }
}

/**
 * Handles incoming slip images
 */
async function handleImageMessage(event: any, userId: string, groupId: string | null) {
  const messageId = event.message.id;
  const replyToken = event.replyToken;

  // Multiple slips sent in a burst each arrive as their own event and are
  // processed in parallel (see webhookHandler). LINE may also redeliver a
  // message if the webhook response is slow — skip anything already handled.
  let db;
  try {
    db = getD1();
  } catch {
    db = null;
  }

  if (db) {
    const seen = await getCachedExtraction(db, `msg:${messageId}`).catch(() => null);
    if (seen) {
      console.log(`[Slip Detection] Message ${messageId} already processed. Skipping duplicate.`);
      return;
    }
  }

  const targetChatId = groupId || userId;
  if (targetChatId) {
    await showLoadingAnimation(targetChatId, 20); // max 20 seconds loading animation
  }

  console.log(`[Slip Detection] Downloading image for message: ${messageId}`);
  const imageBuffer = await downloadMessageImage(messageId);

  // Identical slip images resolve instantly from cache instead of calling the LLM again
  const imageHash = `img:${crypto.createHash('sha256').update(imageBuffer).digest('hex')}`;
  let extraction = db ? await getCachedExtraction(db, imageHash).catch(() => null) : null;
  if (extraction) {
    console.log('[Slip Detection] Extraction served from cache.');
  } else {
    extraction = await extractSlipInfo(imageBuffer);
    if (db && extraction.is_slip) {
      await saveExtractionCache(db, imageHash, extraction).catch(() => {});
    }
  }

  // Mark the message as handled so redeliveries are skipped
  if (db) {
    await saveExtractionCache(db, `msg:${messageId}`, extraction).catch(() => {});
  }

  console.log('[Slip Detection] Vision Result:', extraction);

  // If not a slip, stay completely silent (especially in groups)
  if (!extraction.is_slip || extraction.amount === null) {
    console.log('[Slip Detection] Image is not a recognized slip. Staying silent.');
    return;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const txDate = extraction.date || todayStr;
  const txType: 'income' | 'expense' = extraction.direction === 'income' ? 'income' : 'expense';

  // Category priority: a rule the user taught via LIFF > the LLM's guess > "อื่นๆ"
  const saveDb = db ?? getD1();
  let category = '';
  if (extraction.merchant) {
    const rule = await findCategoryRule(saveDb, extraction.merchant).catch(() => null);
    if (rule && rule.type === txType) category = rule.category;
  }
  if (!category) category = normalizeCategory(extraction.category, txType);

  // Auto-save immediately — no category picker, no user interaction required
  await createTransaction(saveDb, {
    line_user_id: userId,
    line_group_id: groupId,
    amount: extraction.amount,
    type: txType,
    category,
    merchant: extraction.merchant,
    date: txDate
  });
  console.log(`[Slip Detection] Auto-saved: ${txType} ฿${extraction.amount} [${category}]`);

  const flexMessage = createAutoSavedFlex({
    amount: extraction.amount,
    merchant: extraction.merchant,
    date: txDate,
    type: txType,
    category
  });

  await replyLineMessage(replyToken, [flexMessage]);
}

/**
 * Handles text commands like "สรุป" and "ชื่อ [ชื่อเล่น]"
 */
async function handleTextMessage(event: any, userId: string, groupId: string | null) {
  const text = (event.message.text || '').trim();
  const replyToken = event.replyToken;

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
