/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from 'react';
import { AppBar } from '@/components/AppBar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { addErrorLog } from '@/lib/logging';

const loadNoticeText = async (): Promise<string> => {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const markdownUrl = `${baseUrl}THIRD_PARTY_NOTICES.md`;
  const textUrl = `${baseUrl}THIRD_PARTY_NOTICES.txt`;

  try {
    const markdownResponse = await fetch(markdownUrl, { cache: 'no-store' });
    if (markdownResponse.ok) {
      return markdownResponse.text();
    }
  } catch (error) {
    addErrorLog('Failed to load markdown third-party notices', {
      url: markdownUrl,
      error: (error as Error).message,
    });
  }

  const textResponse = await fetch(textUrl, { cache: 'no-store' });
  if (!textResponse.ok) {
    throw new Error(`Failed to load third-party notices (${textResponse.status})`);
  }

  return textResponse.text();
};

export default function OpenSourceLicensesPage() {
  const [noticeText, setNoticeText] = useState<string>('Loading open source licenses...');
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const text = await loadNoticeText();
        if (cancelled) return;
        setNoticeText(text);
        setHasError(false);
      } catch (error) {
        if (cancelled) return;
        const message = (error as Error).message;
        setNoticeText(`Unable to load open source licenses. ${message}`);
        setHasError(true);
        addErrorLog('Failed to load third-party notices', {
          error: message,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen pb-24 pt-[var(--app-bar-height)]">
      <AppBar title="Open Source Licenses" subtitle="Bundled third-party notices" />
      <main className="container py-6">
        <div className="rounded-xl border border-border bg-card">
          <ScrollArea className="h-[calc(100dvh-14rem)]">
            <pre className={`whitespace-pre-wrap break-words p-4 text-xs ${hasError ? 'text-destructive' : 'text-foreground'}`}>
              {noticeText}
            </pre>
          </ScrollArea>
        </div>
      </main>
    </div>
  );
}
