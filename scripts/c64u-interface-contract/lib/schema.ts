import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

export type SchemaValidationResult = { valid: boolean; errors?: string[] };

export class SchemaValidator {
    private readonly ajv: Ajv;

    constructor() {
        this.ajv = new Ajv({ allErrors: true, strict: true });
        addFormats(this.ajv);
    }

    validate(schemaPath: string, data: unknown): SchemaValidationResult {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const validate = this.ajv.compile(schema);
        const valid = validate(data);
        return {
            valid: Boolean(valid),
            errors: validate.errors?.map((err) => `${err.instancePath} ${err.message}`)
        };
    }
}

export function schemaPath(name: string): string {
    return path.join(process.cwd(), "scripts/c64u-interface-contract/schemas", name);
}
