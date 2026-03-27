import previewLayoutAscii from "../../../doc/image/lighting/C64-layout.txt?raw";

export type C64PreviewRegionKind = "case" | "keyboard" | "led";

export type C64PreviewRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type C64PreviewBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type C64PreviewComponent = {
    kind: C64PreviewRegionKind;
    rects: C64PreviewRect[];
    bounds: C64PreviewBounds;
    cellCount: number;
};

export type C64PreviewRegion = {
    kind: C64PreviewRegionKind;
    rects: C64PreviewRect[];
    bounds: C64PreviewBounds | null;
    cellCount: number;
    components: C64PreviewComponent[];
};

export type C64PreviewLayout = {
    width: number;
    height: number;
    source: string;
    regions: Record<C64PreviewRegionKind, C64PreviewRegion>;
    keyboardMain: C64PreviewComponent;
    keyboardFunction: C64PreviewComponent | null;
    ledStrip: C64PreviewComponent;
};

type PreviewGlyph = "x" | "-" | "_";

const GLYPH_TO_REGION: Record<PreviewGlyph, C64PreviewRegionKind> = {
    x: "case",
    "-": "keyboard",
    _: "led",
};

type PreviewCell = {
    x: number;
    y: number;
};

const assertNever = (message: string): never => {
    throw new Error(message);
};

const toBounds = (cells: PreviewCell[]): C64PreviewBounds => {
    const xs = cells.map((cell) => cell.x);
    const ys = cells.map((cell) => cell.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
};

const mergeCellsToRects = (cells: PreviewCell[]): C64PreviewRect[] => {
    const runsByRow = new Map<number, Array<{ x: number; width: number }>>();

    const cellsByRow = new Map<number, number[]>();
    for (const cell of cells) {
        const row = cellsByRow.get(cell.y) ?? [];
        row.push(cell.x);
        cellsByRow.set(cell.y, row);
    }

    for (const [y, xs] of [...cellsByRow.entries()].sort((left, right) => left[0] - right[0])) {
        const sortedXs = [...xs].sort((left, right) => left - right);
        const runs: Array<{ x: number; width: number }> = [];
        let start = sortedXs[0];
        let previous = sortedXs[0];

        for (let index = 1; index < sortedXs.length; index += 1) {
            const current = sortedXs[index];
            if (current === previous + 1) {
                previous = current;
                continue;
            }
            runs.push({ x: start, width: previous - start + 1 });
            start = current;
            previous = current;
        }

        runs.push({ x: start, width: previous - start + 1 });
        runsByRow.set(y, runs);
    }

    const merged: C64PreviewRect[] = [];
    let active = new Map<string, C64PreviewRect>();

    for (const y of [...runsByRow.keys()].sort((left, right) => left - right)) {
        const rowRuns = runsByRow.get(y) ?? [];
        const nextActive = new Map<string, C64PreviewRect>();

        for (const run of rowRuns) {
            const key = `${run.x}:${run.width}`;
            const previous = active.get(key);
            if (previous && previous.y + previous.height === y) {
                previous.height += 1;
                nextActive.set(key, previous);
                continue;
            }

            const rect: C64PreviewRect = {
                x: run.x,
                y,
                width: run.width,
                height: 1,
            };
            merged.push(rect);
            nextActive.set(key, rect);
        }

        active = nextActive;
    }

    return merged.sort((left, right) => left.y - right.y || left.x - right.x);
};

const collectComponents = (rows: string[], glyph: PreviewGlyph): C64PreviewComponent[] => {
    const visited = new Set<string>();
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const components: C64PreviewComponent[] = [];

    const readGlyph = (x: number, y: number) => rows[y]?.[x] ?? null;
    const enqueueKey = (x: number, y: number) => `${x}:${y}`;

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (readGlyph(x, y) !== glyph) {
                continue;
            }
            const startKey = enqueueKey(x, y);
            if (visited.has(startKey)) {
                continue;
            }

            const stack: PreviewCell[] = [{ x, y }];
            const cells: PreviewCell[] = [];
            visited.add(startKey);

            while (stack.length > 0) {
                const current = stack.pop();
                if (!current) {
                    continue;
                }
                cells.push(current);

                const neighbors: PreviewCell[] = [
                    { x: current.x + 1, y: current.y },
                    { x: current.x - 1, y: current.y },
                    { x: current.x, y: current.y + 1 },
                    { x: current.x, y: current.y - 1 },
                ];

                for (const neighbor of neighbors) {
                    if (neighbor.x < 0 || neighbor.x >= width || neighbor.y < 0 || neighbor.y >= height) {
                        continue;
                    }
                    if (readGlyph(neighbor.x, neighbor.y) !== glyph) {
                        continue;
                    }
                    const neighborKey = enqueueKey(neighbor.x, neighbor.y);
                    if (visited.has(neighborKey)) {
                        continue;
                    }
                    visited.add(neighborKey);
                    stack.push(neighbor);
                }
            }

            components.push({
                kind: GLYPH_TO_REGION[glyph],
                rects: mergeCellsToRects(cells),
                bounds: toBounds(cells),
                cellCount: cells.length,
            });
        }
    }

    return components.sort(
        (left, right) =>
            left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y || right.cellCount - left.cellCount,
    );
};

const combineBounds = (components: C64PreviewComponent[]): C64PreviewBounds | null => {
    if (components.length === 0) {
        return null;
    }
    const xs = components.map((component) => component.bounds.x);
    const ys = components.map((component) => component.bounds.y);
    const maxXs = components.map((component) => component.bounds.x + component.bounds.width);
    const maxYs = components.map((component) => component.bounds.y + component.bounds.height);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...maxXs);
    const maxY = Math.max(...maxYs);
    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
};

const buildRegion = (kind: C64PreviewRegionKind, components: C64PreviewComponent[]): C64PreviewRegion => ({
    kind,
    rects: components.flatMap((component) => component.rects),
    bounds: combineBounds(components),
    cellCount: components.reduce((sum, component) => sum + component.cellCount, 0),
    components,
});

export const parseC64PreviewLayout = (source: string): C64PreviewLayout => {
    const rows = source
        .trimEnd()
        .split("\n")
        .map((row) => row.replace(/\r$/, ""));

    if (rows.length === 0 || rows[0].length === 0) {
        assertNever("Lighting preview ASCII layout must not be empty.");
    }

    const width = rows[0].length;
    rows.forEach((row, index) => {
        if (row.length !== width) {
            assertNever(`Lighting preview ASCII row ${index + 1} has width ${row.length}; expected ${width}.`);
        }
        for (const glyph of row) {
            if (glyph !== "x" && glyph !== "-" && glyph !== "_") {
                assertNever(`Lighting preview ASCII row ${index + 1} contains unsupported glyph '${glyph}'.`);
            }
        }
    });

    const caseComponents = collectComponents(rows, "x");
    const keyboardComponents = collectComponents(rows, "-");
    const ledComponents = collectComponents(rows, "_");

    if (keyboardComponents.length === 0) {
        assertNever("Lighting preview ASCII layout must contain at least one keyboard component.");
    }
    if (ledComponents.length !== 1) {
        assertNever(
            `Lighting preview ASCII layout must contain exactly one LED strip component; found ${ledComponents.length}.`,
        );
    }

    return {
        width,
        height: rows.length,
        source: rows.join("\n"),
        regions: {
            case: buildRegion("case", caseComponents),
            keyboard: buildRegion("keyboard", keyboardComponents),
            led: buildRegion("led", ledComponents),
        },
        keyboardMain: [...keyboardComponents].sort(
            (left, right) => right.cellCount - left.cellCount || left.bounds.x - right.bounds.x,
        )[0],
        keyboardFunction:
            [...keyboardComponents].sort(
                (left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y,
            )[1] ?? null,
        ledStrip: ledComponents[0],
    };
};

export const C64_PREVIEW_LAYOUT = parseC64PreviewLayout(previewLayoutAscii);
