import type { FieldDefinition } from "./types.js";

/**
 * Abstracts where the set of queryable fields comes from. The builder
 * component only ever depends on this interface, so swapping the HTTP
 * implementation below for a static array, a cached provider, or a
 * websocket-fed one is a drop-in change.
 */
export interface SchemaProvider {
  getFields(): Promise<readonly FieldDefinition[]>;
}

export class HttpSchemaProvider implements SchemaProvider {
  #endpoint: string;
  #cache: Promise<readonly FieldDefinition[]> | null = null;

  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  async getFields(): Promise<readonly FieldDefinition[]> {
    // Schema rarely changes within a session, so fetch it once and share
    // the in-flight/resolved promise across every caller.
    if (!this.#cache) {
      this.#cache = this.#fetchFields();
    }
    return this.#cache;
  }

  async #fetchFields(): Promise<readonly FieldDefinition[]> {
    const response = await fetch(this.#endpoint);
    if (!response.ok) {
      throw new Error(`Failed to load field schema from ${this.#endpoint}: ${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as { fields: FieldDefinition[] };
    return body.fields;
  }
}

/** A provider for tests/storybooks/offline demos: resolves a fixed list. */
export class StaticSchemaProvider implements SchemaProvider {
  #fields: readonly FieldDefinition[];
  constructor(fields: readonly FieldDefinition[]) {
    this.#fields = fields;
  }
  async getFields(): Promise<readonly FieldDefinition[]> {
    return this.#fields;
  }
}
