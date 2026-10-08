import { normalizeText } from './utils.mjs';
import { readJson, writeJson } from './utils.mjs';
let pendingUpdate = Promise.resolve();

export function ruleKeyForSourceTitle(sourceTitle) {
  return normalizeText(sourceTitle);
}

export async function loadRules(config) {
  const data = await readJson(config.rulesPath, { version: 1, rules: [] });
  return {
    version: 1,
    rules: Array.isArray(data.rules) ? data.rules : [],
  };
}

export async function saveRules(config, rules) {
  await writeJson(config.rulesPath, {
    version: 1,
    rules: rules.rules || [],
  });
}

export function findRule(rules, sourceTitle) {
  const key = ruleKeyForSourceTitle(sourceTitle);
  return (rules.rules || []).find((rule) => rule.key === key) || null;
}

export function rememberRule(config, sourceTitle, values) {
  const update = pendingUpdate.catch(() => {}).then(() => updateRule(config, sourceTitle, values));
  pendingUpdate = update;
  return update;
}

async function updateRule(config, sourceTitle, values) {
  if (!sourceTitle || !values?.notePath) return null;
  const rules = await loadRules(config);
  const key = ruleKeyForSourceTitle(sourceTitle);
  const previousRule = (rules.rules || []).find((rule) => rule.key === key) || null;
  const nextRule = {
    key,
    sourceTitle,
    notePath: values.notePath,
    mode: values.mode || 'episode',
    season: Number(values.season) || null,
  };
  const index = rules.rules.findIndex((rule) => rule.key === key);
  if (index === -1) {
    rules.rules.push(nextRule);
  } else {
    rules.rules[index] = { ...rules.rules[index], ...nextRule };
  }
  rules.rules.sort((a, b) => a.key.localeCompare(b.key));
  await saveRules(config, rules);
  return {
    key,
    previousRule,
    nextRule,
  };
}
