'use strict';
// SharePoint クライアント
// 改修(SP連携マージ): axios/Azure AD方式から Python sp_helper.py 子プロセス方式に全面置換
// （社内プロキシの NTLM 認証を Python requests で透過的に処理するため）
const { spawn } = require('child_process');
const path = require('path');

const HELPER = path.join(__dirname, 'sp_helper.py');

// ── Python ヘルパー呼び出し ──
function runHelper(args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      SITE_URL:          process.env.SITE_URL     || '',
      SP_LIST_PATH:      process.env.SP_LIST_PATH || '',
      PROXY_URL:         process.env.PROXY_URL    || '',
      PYTHONIOENCODING:  'utf-8',
    };

    const proc = spawn('python', [HELPER, ...args], { env, windowsHide: true });

    let stdout = '';
    let timer  = setTimeout(() => {
      proc.kill();
      reject(new Error('Python タイムアウト'));
    }, timeoutMs);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { process.stdout.write(d); }); // デバイスコードのメッセージを転送

    proc.on('close', () => {
      clearTimeout(timer);
      const out = stdout.trim();
      if (!out) return reject(new Error('Python から出力なし'));
      try {
        const result = JSON.parse(out);
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch (_) {
        reject(new Error('Python 出力のパース失敗: ' + out.slice(0, 200)));
      }
    });

    proc.on('error', reject);
  });
}

// トークン取得（デバイスコードフロー含む）
async function getAppToken() {
  const result = await runHelper(['get_token'], 300000); // 5分（デバイスコード入力待ち）
  return result.token;
}

// リストアイテム一覧取得
async function getListItems() {
  const result = await runHelper(['get_items']);
  return result.items;
}

// アイテム新規作成
async function addListItem(_token, fields) {
  const result = await runHelper(['add_item', JSON.stringify(fields)]);
  return result.item;
}

// アイテム更新
async function updateListItem(_token, itemId, fields) {
  await runHelper(['update_item', String(itemId), JSON.stringify(fields)]);
}

// アイテム削除
async function deleteListItem(_token, itemId) {
  await runHelper(['delete_item', String(itemId)]);
}

module.exports = { getAppToken, getListItems, addListItem, updateListItem, deleteListItem };
