import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface PowerOffDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    isPending: boolean;
}

export function PowerOffDialog({ open, onOpenChange, onConfirm, isPending }: PowerOffDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm Power Off</DialogTitle>
                    <DialogDescription>
                        Once powered off, this machine cannot be powered on again via software.
                        Use the physical power button on the device to power it back on.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={onConfirm}
                        disabled={isPending}
                    >
                        {isPending ? 'Powering off…' : 'Power Off'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
