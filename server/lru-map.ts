/** A Map that forgets the least recently used key past `max`, so a cache keeps its hot entries instead of being emptied whole. */
export class LruMap<K, V> extends Map<K, V> {
  readonly #max: number;

  constructor(max: number) {
    super();
    this.#max = max;
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    if (this.size > this.#max) super.delete(this.keys().next().value as K);
    return this;
  }
}
