export const getOnOffButtonClass = (enabled: boolean) =>
    enabled
        ? 'bg-success/15 text-success border-success/40 hover:bg-success/25 hover:text-success'
        : 'bg-muted text-muted-foreground border-muted/60 hover:bg-muted/80 hover:text-muted-foreground';
