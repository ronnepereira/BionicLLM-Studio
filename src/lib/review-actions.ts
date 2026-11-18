export interface ReviewDraft<T> { id: string; account: string; input: T; phase: 'pending' | 'uncertain' | 'done'; created_at: number; remote_id: string | null }
