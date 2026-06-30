'use strict';
// SharePoint REST API クライアント（Pythonアプリの sp_headers/get_items/update_item 相当）
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

function buildAxiosConfig(token) {
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json;odata=verbose',
      'Content-Type': 'application/json;odata=verbose',
    },
  };
  if (process.env.PROXY_URL) {
    config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
    config.proxy = false;
  }
  return config;
}

function buildProxyConfig() {
  const config = {};
  if (process.env.PROXY_URL) {
    config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
    config.proxy = false;
  }
  return config;
}

// トークン取得（client_credentials フロー）
async function getAppToken() {
  const { TENANT_ID, CLIENT_ID, CLIENT_SECRET, SITE_URL } = process.env;
  const siteHost = new URL(SITE_URL).hostname;
  const scope = `https://${siteHost}/.default`;

  const res = await axios.post(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope,
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      ...buildProxyConfig(),
    }
  );

  if (!res.data.access_token) {
    throw new Error('トークン取得失敗: ' + JSON.stringify(res.data));
  }
  return res.data.access_token;
}

// リストアイテム一覧取得
async function getListItems(token, filterQuery = null) {
  const { SITE_URL, SP_LIST_PATH } = process.env;
  const siteUrl = SITE_URL.replace(/\/$/, '');
  let url = `${siteUrl}/_api/web/GetList('${SP_LIST_PATH}')/items?$top=5000`;
  if (filterQuery) url += `&$filter=${encodeURIComponent(filterQuery)}`;

  const res = await axios.get(url, buildAxiosConfig(token));
  return res.data.d.results;
}

// エンティティタイプ名を取得（書き込み操作に必要）
async function getEntityTypeName(token) {
  const { SITE_URL, SP_LIST_PATH } = process.env;
  const siteUrl = SITE_URL.replace(/\/$/, '');
  const url = `${siteUrl}/_api/web/GetList('${SP_LIST_PATH}')?$select=ListItemEntityTypeFullName`;
  const res = await axios.get(url, buildAxiosConfig(token));
  return res.data.d.ListItemEntityTypeFullName;
}

// アイテム新規作成
async function addListItem(token, fields) {
  const { SITE_URL, SP_LIST_PATH } = process.env;
  const siteUrl = SITE_URL.replace(/\/$/, '');
  const entityType = await getEntityTypeName(token);

  const body = { __metadata: { type: entityType }, ...fields };
  const url = `${siteUrl}/_api/web/GetList('${SP_LIST_PATH}')/items`;
  const res = await axios.post(url, body, buildAxiosConfig(token));
  return res.data.d;
}

// アイテム更新（MERGE）
async function updateListItem(token, itemId, fields) {
  const { SITE_URL, SP_LIST_PATH } = process.env;
  const siteUrl = SITE_URL.replace(/\/$/, '');
  const entityType = await getEntityTypeName(token);

  const body = { __metadata: { type: entityType }, ...fields };
  const url = `${siteUrl}/_api/web/GetList('${SP_LIST_PATH}')/items(${itemId})`;
  const config = {
    ...buildAxiosConfig(token),
    headers: {
      ...buildAxiosConfig(token).headers,
      'IF-MATCH': '*',
      'X-HTTP-Method': 'MERGE',
    },
  };
  await axios.post(url, body, config);
}

module.exports = { getAppToken, getListItems, addListItem, updateListItem };
