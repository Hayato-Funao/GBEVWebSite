"""
hils_alert.py — 終了前日アラートスクリプト（第15回改修 W-19）

Windows タスクスケジューラで毎朝 08:00 に実行する。
統合HILS使用履歴リストの終了日（field_7）が翌日の予約を抽出し、
利用期間が3日以上（両端含む暦日数 >= 3）の場合のみ申請者へアラートメールを送信する。
"""
import sys
import os
import json
import re
import subprocess
from datetime import date, timedelta

# ── .env 読み込み（sp_helper.py 29〜38行と同方式: backend/../.env を参照）──
_HERE = os.path.dirname(__file__)
_env_path = os.path.join(_HERE, '..', '.env')
if os.path.exists(_env_path):
	with open(_env_path, encoding='utf-8') as _f:
		for _line in _f:
			_m = re.match(r'^([^#=\s][^=]*)=(.*)', _line)
			if _m:
				_k, _v = _m.group(1).strip(), _m.group(2).strip()
				# 既存の環境変数は上書きしない
				if not os.environ.get(_k):
					os.environ[_k] = _v


def run_sp_command(cmd, *args):
	"""sp_helper.py をサブプロセスで実行してJSONを返す"""
	result = subprocess.run(
		[sys.executable, os.path.join(_HERE, 'sp_helper.py'), cmd, *args],
		capture_output=True,
		text=True,
		timeout=300,
	)
	return json.loads(result.stdout)


# 改修: 事務局宛先(To)・各CCのコンソール設定（server.js起動時に入力・保存）を読み込む。
# Node側と同じ backend/mail_config.json を参照することで、フロント発メールとアラートメールの
# お問い合わせ先・CC設定を一元管理する
_MAIL_CONFIG_PATH = os.path.join(_HERE, 'mail_config.json')
_MAIL_CONFIG_DEFAULT = {
	'pmoTo':   'hayato_funao_gst@jp.honda',
	'pmoCc':   '',
	'userCc':  '',
	'alertCc': '',
}


def load_mail_config():
	"""mail_config.json を読み込む（存在しない/壊れている場合は既定値を返す）"""
	try:
		with open(_MAIL_CONFIG_PATH, encoding='utf-8') as f:
			cfg = dict(_MAIL_CONFIG_DEFAULT)
			cfg.update(json.load(f))
			return cfg
	except Exception:
		return dict(_MAIL_CONFIG_DEFAULT)


def parse_sp_date(val):
	"""
	SharePoint の日付値（/Date(ms)/ 形式または ISO 形式）を date オブジェクトへ変換する。
	server.js extractDate（270〜278行）と同等のパース処理。
	変換不可の場合は None を返す。
	"""
	if not val:
		return None
	s = str(val)
	# /Date(ミリ秒)/ 形式
	ms_match = re.match(r'/Date\((\d+)\)/', s)
	if ms_match:
		from datetime import datetime, timezone
		return datetime.fromtimestamp(int(ms_match.group(1)) / 1000, tz=timezone.utc).date()
	# ISO 形式（T を含む場合は日付部分のみ取得）
	if 'T' in s:
		return date.fromisoformat(s.split('T')[0])
	# YYYY-MM-DD 形式
	try:
		return date.fromisoformat(s[:10])
	except ValueError:
		return None


def main():
	# 改修: 事務局宛先(To)先頭アドレス(署名の問い合わせ先用)・アラートメールCCをコンソール設定から取得
	mail_config = load_mail_config()
	pmo_contact = (mail_config.get('pmoTo') or '').split(',')[0].strip()
	alert_cc = mail_config.get('alertCc') or ''

	# 翌日の日付を取得
	tomorrow = date.today() + timedelta(days=1)

	# 使用履歴リストの全件取得（戻り値は {'items': [...]}）
	response = run_sp_command('get_items')
	items = response.get('items', [])

	# 終了日が翌日の予約を抽出
	targets = []
	for item in items:
		end_date = parse_sp_date(item.get('field_7'))
		if end_date == tomorrow:
			targets.append(item)

	if not targets:
		print(f'終了前日の予約なし（{tomorrow.isoformat()}）')
		return

	sent_count = 0
	for item in targets:
		machine = item.get('field_1', '（筐体不明）')   # 設備（筐体名）
		end_date = parse_sp_date(item.get('field_7'))   # 設備使用終了日
		start_date = parse_sp_date(item.get('field_6')) # 設備使用開始日（3日以上判定に使用）

		# 利用期間が3日以上かどうかチェック（両端含む暦日数 >= 3）
		# 例: 開始7/10・終了7/12 → (7/12-7/10).days+1=3 → 送信
		# 例: 開始7/11・終了7/12 → (7/12-7/11).days+1=2 → スキップ
		if start_date is None:
			print(f'スキップ（開始日取得不可）: {machine}')
			continue
		duration_days = (end_date - start_date).days + 1
		if duration_days < 3:
			print(f'スキップ（利用期間{duration_days}日 < 3日）: {machine} {start_date.isoformat()}〜{end_date.isoformat()}')
			continue

		# 申請者メールアドレス（使用者アドレス列: 32文字截断の内部名）
		applicant_email = item.get('OData__x7533__x8acb__x8005__x30a2__x30', '')
		# 改修: アドレス列（筐体ごとの手入力識別情報。メールアドレスとは別物。南HILSルームのみ使用）
		address = item.get('OData__x30a2__x30c9__x30ec__x30b9_', '')

		if not applicant_email:
			print(f'スキップ（申請者メールアドレス未設定）: {machine}')
			continue

		# 改修: 動作確認用の固定宛先を廃止し、本来の宛先（申請者アドレス）へ戻す
		to_address = applicant_email

		# 改修(メール文面): 申請者名（取得不可時は省略）
		# 候補列: 申請者名系の内部名（実機確認後に正式名へ変更すること）
		applicant_name = item.get('field_2', '') or item.get('OData__x7533__x8acb__x8005__x540d__x', '')
		# 改修: 予約ID＝事務局アクションリストID列（登録時に起動URLのid値=SP内部IDを転記）。旧データはTitleへフォールバック
		action_list_id = item.get('OData__x4e8b__x52d9__x5c40__x30a2__x30', '')
		reservation_id = str(action_list_id) if action_list_id not in (None, '') else item.get('Title', '')

		end_str = end_date.isoformat()
		app_url = os.environ.get('APP_URL', 'http://RC25020358:3000/')

		# 改修(メール文面): 共通署名ブロック（JS側 mailSignature() と同内容）
		# 改修: お問い合わせ先はコンソール設定の事務局宛先(pmoTo)先頭アドレスへ統一
		signature = (
			'\n────────────────────\n'
			'統合HILS予約管理表事務局\n'
			f'お問い合わせ: {pmo_contact}\n'
			f'予約管理表: {app_url}\n'
			'────────────────────'
		)

		try:
			# 改修(メール文面): 提案資料⑨に合わせて件名・本文を更新
			# 改修: アドレス（筐体ごとの手入力識別情報。メールアドレスとは別物）があれば＜アドレス 筐体名＞に拡張
			subject_inner = f'{address} {machine}' if address else machine
			subject = f'【統合HILS（61号棟南HILSルーム）予約】使用期間終了前日のご案内＜{subject_inner}＞'
			body_lines = []
			if applicant_name:
				body_lines.append(f'{applicant_name} 様\n')
			body_lines.append('ご使用中の統合HILSについて、明日が使用終了予定日です。\n')
			body_lines.append('■対象予約')
			if reservation_id:
				body_lines.append(f' 予約ID : {reservation_id}')
			body_lines.append(f' 筐体名 : {machine}')
			body_lines.append(f' 終了予定日: {end_str}\n')
			body_lines.append('・期間の延長が必要な場合は、下記ページより期間変更を申請してください。')
			body_lines.append('・使用を終了される場合は、HILSを初期状態へ復帰のうえ、下記ページより利用終了報告をお願いします。\n')
			# 改修: ユーザー用サイトURLに予約ID（事務局アクションリストID列）を付与し、開くと該当予約が自動入力されるようにする
			alert_url = f'{app_url}?id={reservation_id}' if reservation_id else app_url
			body_lines.append(f' 期間変更・利用終了報告: {alert_url}')
			mail_body = '\n'.join(body_lines) + signature
			# 改修: アラートメールCC（コンソール設定）を付与
			run_sp_command('send_mail', to_address, subject, mail_body, alert_cc)
			print(f'アラートメール送信完了: {machine} ({start_date.isoformat()}〜{end_str}) → {to_address}')
			sent_count += 1
		except Exception as e:
			print(f'メール送信失敗: {machine} / {e}')

	print(f'処理完了: 対象{len(targets)}件 送信{sent_count}件')


if __name__ == '__main__':
	main()
