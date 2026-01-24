import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConnectionState } from '@/hooks/useConnectionState';
import { dismissDemoInterstitial, discoverConnection } from '@/lib/connection/connectionManager';

export function DemoModeInterstitial() {
  const { demoInterstitialVisible } = useConnectionState();

  if (!demoInterstitialVisible) return null;

  return (
    <Dialog
      open={demoInterstitialVisible}
      onOpenChange={(open) => {
        if (!open) dismissDemoInterstitial();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Demo Mode</DialogTitle>
          <DialogDescription>
            No C64 Ultimate was found during startup discovery. You can continue in Demo Mode using the built-in simulated device,
            or retry connecting to real hardware.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <div className="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => {
                dismissDemoInterstitial();
                void discoverConnection('manual');
              }}
            >
              Retry connection
            </Button>
            <Button
              variant="default"
              onClick={() => {
                dismissDemoInterstitial();
              }}
            >
              Continue in Demo Mode
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

