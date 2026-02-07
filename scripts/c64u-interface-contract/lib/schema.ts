import fs from "node:fs";
import path from "node:path";
import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

export type SchemaValidationResult = { valid: boolean; errors?: string[] };

type AjvLike = {
    compile: (schema: unknown) => {
        (data: unknown): boolean;
        errors?: ErrorObject[];
    };
};

export class SchemaValidator {
    private readonly ajv: AjvLike;

    constructor() {
        const AjvCtor = Ajv as unknown as new (opts?: unknown) => AjvLike;
        this.ajv = new AjvCtor({ allErrors: true, strict: true });
        const addFormatsFn = addFormats as unknown as (ajv: AjvLike) => void;
        addFormatsFn(this.ajv);
    }

    validate(schemaPath: string, data: unknown): SchemaValidationResult {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const validate = this.ajv.compile(schema);
        const valid = validate(data);
        return {
            valid: Boolean(valid),
            errors: validate.errors?.map((err: ErrorObject) => `${err.instancePath} ${err.message}`)
        };
    }
}

export function schemaPath(name: string): string {
    return path.join(process.cwd(), "scripts/c64u-interface-contract/schemas", name);
}
