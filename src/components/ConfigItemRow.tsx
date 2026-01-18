import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ConfigItemRowProps {
  name: string;
  value: string | number;
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
  onValueChange: (value: string | number) => void;
  isLoading?: boolean;
}

export function ConfigItemRow({
  name,
  value,
  options,
  details,
  onValueChange,
  isLoading = false,
}: ConfigItemRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));

  const isNumeric = details?.min !== undefined && details?.max !== undefined;
  const isPreset = details?.presets !== undefined;
  const hasOptions = options && options.length > 0;
  const isEditable = hasOptions || isNumeric || isPreset;

  const handleSelect = (newValue: string) => {
    onValueChange(newValue);
    setIsOpen(false);
  };

  const handleNumericSubmit = () => {
    const numVal = parseFloat(inputValue);
    if (!isNaN(numVal) && details?.min !== undefined && details?.max !== undefined) {
      const clamped = Math.max(details.min, Math.min(details.max, numVal));
      onValueChange(clamped);
      setInputValue(String(clamped));
    }
    setIsOpen(false);
  };

  const displayValue = typeof value === 'string' ? value : String(value);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild disabled={!isEditable}>
        <button
          className={`settings-row w-full text-left ${isEditable ? 'cursor-pointer active:bg-muted/50' : 'cursor-default'}`}
          disabled={!isEditable}
        >
          <span className="text-sm font-medium flex-1 pr-4">{name}</span>
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <>
                <span className="value-badge max-w-[150px] truncate">
                  {displayValue || '—'}
                </span>
                {isEditable && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </>
            )}
          </div>
        </button>
      </SheetTrigger>
      
      <SheetContent side="bottom" className="h-[70vh] rounded-t-2xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="font-mono text-lg">{name}</SheetTitle>
        </SheetHeader>
        
        {isNumeric ? (
          <div className="space-y-4 p-4">
            <div className="text-sm text-muted-foreground">
              Range: {details?.min} — {details?.max}
              {details?.format && ` (${details.format})`}
            </div>
            <Input
              type="number"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              min={details?.min}
              max={details?.max}
              className="font-mono text-lg"
            />
            <Button onClick={handleNumericSubmit} className="w-full">
              Apply
            </Button>
          </div>
        ) : (
          <ScrollArea className="h-[calc(70vh-100px)]">
            <div className="space-y-1 p-2">
              <AnimatePresence>
                {(options || details?.presets || []).map((option, index) => {
                  const isSelected = option === displayValue;
                  return (
                    <motion.button
                      key={option}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.02 }}
                      onClick={() => handleSelect(option)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors ${
                        isSelected 
                          ? 'bg-primary/10 text-primary' 
                          : 'hover:bg-muted'
                      }`}
                    >
                      <span className="font-mono text-sm">{option || '(empty)'}</span>
                      {isSelected && <Check className="h-5 w-5" />}
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
