// کاتالوگ آزمایشی: سه مدل با توکن‌هایی که کار catalog هم می‌سازد
export const MODELS = [
  { id: 'apple_iphone_13', brand: 'apple', name: 'iPhone 13', norm: 'iphone 13', type: 'phone', storages: [128, 256], rams: [4], colors: ['black'], tokens: ['iphone', '13'] },
  { id: 'samsung_galaxy_a54', brand: 'samsung', name: 'Galaxy A54', norm: 'galaxy a 54', type: 'phone', storages: [128, 256], rams: [6, 8], colors: ['black'], tokens: ['galaxy', 'a', '54'] },
  { id: 'apple_ipad_9', brand: 'apple', name: 'iPad 9', norm: 'ipad 9', type: 'tablet', storages: [64, 256], rams: [3], colors: [], tokens: ['ipad', '9'] },
];

export function seedCatalog(world, source = 'manual') {
  for (const m of MODELS) {
    world.run(
      `INSERT INTO device_catalog (model_id, brand, name, name_norm, alias_tokens, type, year, storages, rams, colors, specs, source, verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', ?, NULL, ?, ?, ?, NULL, ?, 1, 1, 1)`,
      m.id, m.brand, m.name, m.norm, m.type, JSON.stringify(m.storages), JSON.stringify(m.rams), JSON.stringify(m.colors), source,
    );
    for (const t of m.tokens) world.run('INSERT INTO model_tokens (token, model_id) VALUES (?, ?)', t, m.id);
  }
}
