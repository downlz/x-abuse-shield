/**
 * Map and Set that forget their oldest entries past a limit. x.com is one long-lived page: a content script
 * that remembers every post, account and text it has seen grows for as long as the tab is open, which a
 * phone notices after an hour of scrolling. Writing an entry again makes it the newest.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  constructor(readonly limit: number) {
    super();
  }

  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    if (this.size > this.limit) this.delete(this.keys().next().value!);
    return this;
  }
}

export class BoundedSet<T> extends Set<T> {
  constructor(readonly limit: number) {
    super();
  }

  override add(value: T): this {
    if (this.has(value)) this.delete(value);
    super.add(value);
    if (this.size > this.limit) this.delete(this.values().next().value!);
    return this;
  }
}
