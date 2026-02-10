import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfigItem {
    id: string;
    name: string;
    savedAt: string;
}

interface LoadConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configs: ConfigItem[];
    onLoad: (id: string) => void;
    applyingConfigId: string | null;
}

export function LoadConfigDialog({
    open,
    onOpenChange,
    configs,
    onLoad,
    applyingConfigId,
}: LoadConfigDialogProps) {
    const isApplying = applyingConfigId !== null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Load from App</DialogTitle>
                    <DialogDescription>Select a saved configuration to apply to the C64U.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {configs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
                    ) : (
                        configs.map((config) => (
                            <Button
                                key={config.id}
                                variant="outline"
                                className="w-full justify-between h-auto py-2"
                                onClick={() => onLoad(config.id)}
                                disabled={isApplying}
                            >
                                <div className="flex flex-col items-start gap-0.5">
                                    <span className="font-medium">{config.name}</span>
                                    <span className="text-xs text-muted-foreground font-normal">
                                        {new Date(config.savedAt).toLocaleString()}
                                    </span>
                                </div>
                                <span className="text-xs text-muted-foreground ml-2">
                                    {applyingConfigId === config.id ? 'Applying…' : 'Load'}
                                </span>
                            </Button>
                        ))
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
