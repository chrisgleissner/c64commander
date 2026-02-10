import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfigItem {
    id: string;
    name: string;
    savedAt: string;
}

interface ManageConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configs: ConfigItem[];
    onRename: (id: string, newName: string) => void;
    onDelete: (id: string) => void;
}

export function ManageConfigDialog({
    open,
    onOpenChange,
    configs,
    onRename,
    onDelete,
}: ManageConfigDialogProps) {
    const [renameValues, setRenameValues] = useState<Record<string, string>>({});

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Manage App Configs</DialogTitle>
                    <DialogDescription>Rename or delete saved configurations.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                    {configs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No saved configurations yet.</p>
                    ) : (
                        configs.map((config) => (
                            <div key={config.id} className="flex flex-col gap-2 border border-border rounded-lg p-3">
                                <Input
                                    value={renameValues[config.id] ?? config.name}
                                    onChange={(e) =>
                                        setRenameValues((prev) => ({ ...prev, [config.id]: e.target.value }))
                                    }
                                />
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(config.savedAt).toLocaleString()}
                                    </span>
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => onRename(config.id, renameValues[config.id]?.trim() || config.name)}
                                        >
                                            Rename
                                        </Button>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => onDelete(config.id)}
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            </div>
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
