export interface DataPartValue {
  citations?: string[];
  ragUsed?: boolean;
  ragId?: string | null;
  type?: string;
  content?: string;
  finishReason?: string;
  sandboxType?: 'persistent-sandbox' | 'temporary-sandbox';
  // Thinking
  elapsed_secs?: number;
  // For new chat
  chatTitle?: string | null;
}
