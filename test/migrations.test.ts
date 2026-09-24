import fs from 'fs';
import path from 'path';

/**
 * Structural guard for the summary SQL functions.
 *
 * Regression being locked down: in get_summary_by_category the WHERE clause was
 *   (group match) or (user match) and (start date) and (end date)
 * Since AND binds tighter than OR in SQL, the date guards only applied to the
 * user branch — group summaries silently ignored the date range and returned
 * all-time totals.
 *
 * Limitation: this file checks the SQL text structure, not live Postgres
 * semantics. Run the migration against a real database (e.g. Supabase SQL
 * editor) to verify behaviour end-to-end.
 */

function getFunctionBody(sql: string, functionName: string): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${functionName}\\s*\\([\\s\\S]*?as\\s*\\$\\$([\\s\\S]*?)\\$\\$`,
    'i'
  );
  const match = sql.match(re);
  if (!match) {
    throw new Error(`Function ${functionName} not found in migration SQL`);
  }
  // Strip -- comments so prose like "a or b and c and d" is not parsed as SQL operators
  return match[1].replace(/--[^\n]*/g, '');
}

interface Segment {
  op: 'WHERE' | 'AND' | 'OR';
  text: string;
}

/** Split a WHERE clause into segments joined at paren depth 0. */
function topLevelSegments(whereClause: string): Segment[] {
  const segments: Segment[] = [];
  let depth = 0;
  let current = '';
  let op: Segment['op'] = 'WHERE';

  for (let i = 0; i < whereClause.length; i++) {
    const ch = whereClause[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;

    if (depth === 0) {
      const rest = whereClause.slice(i);
      const andMatch = rest.match(/^\s+and\s/i);
      const orMatch = rest.match(/^\s+or\s/i);
      if (andMatch || orMatch) {
        const keyword = (andMatch || orMatch)![0];
        segments.push({ op, text: current.trim() });
        op = andMatch ? 'AND' : 'OR';
        i += keyword.length - 1;
        current = '';
        continue;
      }
    }
    current += ch;
  }
  segments.push({ op, text: current.trim() });
  return segments;
}

function expectDateGuardsAtTopLevel(sqlPath: string): void {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const body = getFunctionBody(sql, 'get_summary_by_category');
  const whereIdx = body.toLowerCase().indexOf('where');
  expect(whereIdx).toBeGreaterThan(-1);

  const segments = topLevelSegments(body.slice(whereIdx + 'where'.length));

  // The scope group (user-or-group match) must be a single top-level segment
  // ANDed with the two date guards — never ORed against them.
  expect(segments.map(s => s.op)).toEqual(['WHERE', 'AND', 'AND']);

  const scopeGroup = segments[0].text;
  expect(scopeGroup.startsWith('(')).toBe(true);
  expect(scopeGroup.endsWith(')')).toBe(true);
  expect(/\bor\b/i.test(scopeGroup)).toBe(true); // the user/group alternatives live inside the group

  expect(segments[1].text).toMatch(/p_start_date\s+is\s+null\s+or\s+t\.date\s+>=\s+p_start_date/i);
  expect(segments[2].text).toMatch(/p_end_date\s+is\s+null\s+or\s+t\.date\s+<=\s+p_end_date/i);
}

describe('Summary SQL migrations', () => {
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  it('001_init.sql keeps the date guards ANDed with the scope group', () => {
    expectDateGuardsAtTopLevel(path.join(migrationsDir, '001_init.sql'));
  });

  it('002_fix_summary_date_filter.sql provides the corrected function for existing databases', () => {
    const fixPath = path.join(migrationsDir, '002_fix_summary_date_filter.sql');
    expect(fs.existsSync(fixPath)).toBe(true);
    expectDateGuardsAtTopLevel(fixPath);
  });
});
