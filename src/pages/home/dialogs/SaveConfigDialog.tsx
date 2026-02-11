import { useEffect, useState } from 'react';
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
import { toast } from '@/hooks/use-toast';

interface SaveConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    existingNames: string[];
    onSave: (name: string) => Promise<void>;
    isSaving: boolean;
}

export function SaveConfigDialog({
    open,
    onOpenChange,
    existingNames,
    onSave,
    isSaving,
}: SaveConfigDialogProps) {
    const [name, setName] = useState('');

    // Reset name when dialog opens
    useEffect(() => {
        if (open) setName('');
    }, [open]);

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            toast({ title: 'Name required', description: 'Enter a config name first.' });
            return;
        }
        if (existingNames.includes(trimmed)) {
            toast({ title: 'Name already used', description: 'Choose a unique config name.' });
            return;
        }
        await onSave(trimmed);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Save to App</DialogTitle>
                    <DialogDescription>Store the current C64U configuration in this app.</DialogDescription>
                </DialogHeader>
                <Input
                    placeholder="Config name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={isSaving}>Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
