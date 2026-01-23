export const redactTreeUri = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('/');
  if (parts.length <= 2) {
    return trimmed.length > 12 ? `${trimmed.slice(0, 12)}...` : trimmed;
  }
  const last = parts[parts.length - 1] || '';
  const short = last.length > 8 ? `${last.slice(0, 4)}...${last.slice(-3)}` : last;
  return `${parts.slice(0, -1).join('/')}/${short}`;
};
