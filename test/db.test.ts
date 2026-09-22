import {
  upsertUser,
  upsertGroup,
  createTransaction,
  getCategorySummary,
  getGroupMemberSummary
} from '../src/db/queries';

describe('Database Queries Helper', () => {
  it('should call upsert on users table correctly', async () => {
    const mockSingle = jest.fn().mockResolvedValue({
      data: { line_user_id: 'U123', nickname: 'John' },
      error: null
    });
    const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
    const mockUpsert = jest.fn().mockReturnValue({ select: mockSelect });
    const mockFrom = jest.fn().mockReturnValue({ upsert: mockUpsert });

    const mockClient = { from: mockFrom } as any;

    const result = await upsertUser(mockClient, {
      line_user_id: 'U123',
      nickname: 'John'
    });

    expect(mockFrom).toHaveBeenCalledWith('users');
    expect(mockUpsert).toHaveBeenCalledWith({
      line_user_id: 'U123',
      nickname: 'John'
    });
    expect(result.nickname).toBe('John');
  });

  it('should call insert on transactions table correctly', async () => {
    const mockTx = {
      line_user_id: 'U123',
      amount: 150,
      type: 'expense' as const,
      category: 'อาหาร',
      date: '2026-09-23'
    };

    const mockSingle = jest.fn().mockResolvedValue({
      data: { id: 'uuid-1', ...mockTx },
      error: null
    });
    const mockSelect = jest.fn().mockReturnValue({ single: mockSingle });
    const mockInsert = jest.fn().mockReturnValue({ select: mockSelect });
    const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });

    const mockClient = { from: mockFrom } as any;

    const result = await createTransaction(mockClient, mockTx);

    expect(mockFrom).toHaveBeenCalledWith('transactions');
    expect(mockInsert).toHaveBeenCalledWith(mockTx);
    expect(result.amount).toBe(150);
  });

  it('should call get_summary_by_category RPC correctly', async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: [
        { category: 'อาหาร', type: 'expense', total_amount: 500, transaction_count: 3 }
      ],
      error: null
    });

    const mockClient = { rpc: mockRpc } as any;

    const res = await getCategorySummary(mockClient, {
      groupId: 'G123',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    expect(mockRpc).toHaveBeenCalledWith('get_summary_by_category', {
      p_user_id: null,
      p_group_id: 'G123',
      p_start_date: '2026-09-01',
      p_end_date: '2026-09-30'
    });
    expect(res).toHaveLength(1);
    expect(res[0].category).toBe('อาหาร');
  });

  it('should call get_group_member_summary RPC correctly', async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: [
        { line_user_id: 'U1', nickname: 'ฟ้า', total_paid: 8000, transaction_count: 5 },
        { line_user_id: 'U2', nickname: 'เจ', total_paid: 5000, transaction_count: 3 }
      ],
      error: null
    });

    const mockClient = { rpc: mockRpc } as any;

    const res = await getGroupMemberSummary(mockClient, {
      groupId: 'G123'
    });

    expect(mockRpc).toHaveBeenCalledWith('get_group_member_summary', {
      p_group_id: 'G123',
      p_start_date: null,
      p_end_date: null
    });
    expect(res).toHaveLength(2);
    expect(res[0].nickname).toBe('ฟ้า');
    expect(res[0].total_paid).toBe(8000);
  });
});
