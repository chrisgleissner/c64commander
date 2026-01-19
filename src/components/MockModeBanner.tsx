import { useMockMode } from '@/hooks/useMockMode';

export function MockModeBanner() {
  const { isMockMode, mockBaseUrl } = useMockMode();

  if (!isMockMode) return null;

  return (
    <div className="bg-destructive text-destructive-foreground text-[11px] font-semibold tracking-wide px-3 py-2 text-center">
      Internal testing mode: Mocked C64U active. No real hardware is being controlled.
      {mockBaseUrl ? (
        <span className="ml-2 font-mono text-[10px]">{mockBaseUrl}</span>
      ) : null}
    </div>
  );
}
