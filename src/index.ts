export default {
	async email(message, env, ctx) {
		const webhookUrl = env.DISCORD_WEBHOOK_URL;
		const subject = message.headers.get('subject')
		const body = (await getMessageBody(message)) || "本文なし"
		const data = {
			"content": `送信元:${message.from}\n宛先:${message.to}\n件名:${subject || "件名なし"}\n\n${body}`
		}
		const res = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(data)
		})
		if (res.ok) {
			console.log("転送成功");
		} else {
			console.error("転送失敗", res.statusText, await res.text(), data)
		}

		const forwardEmailAddress: string | undefined = env.FORWARD_EMAIL_ADDRESS;
		if (forwardEmailAddress) {
			// 転送用のメールアドレスが設定されている場合、転送メールを送信
			try {
				await message.forward(forwardEmailAddress)
			} catch (error) {
				console.error("転送メールの送信に失敗:", error);
			}
		}
	}
} satisfies ExportedHandler<Env>;

const getMessageRaw = async (message: ForwardableEmailMessage) => {
	const messageReader = await message.raw.getReader()
	const decoder = new TextDecoder()
	let fullMessageText = ""
	while (true) {
		const { done, value } = await messageReader.read()
		if (done) break;
		const messageChunk = decoder.decode(value)
		fullMessageText += messageChunk;
	}
	return fullMessageText;
}

const getMessageBody = async (message: ForwardableEmailMessage) => {
	const fullMessage = await getMessageRaw(message);

	// メールヘッダーと本文を分離（空行で区切られる）
	const parts = fullMessage.split('\r\n\r\n');
	if (parts.length < 2) {
		return fullMessage;
	}

	const headerPart = parts[0];
	const bodyPart = parts.slice(1).join('\r\n\r\n');

	// マルチパート境界を探す
	const boundaryMatch = headerPart.match(/boundary="?([^"\s;]+)"?/);
	if (boundaryMatch) {
		const boundary = boundaryMatch[1];
		const multiparts = bodyPart.split(`--${boundary}`);

		// text/plainパートを探す
		for (const part of multiparts) {
			if (part.includes('Content-Type: text/plain')) {
				// パート内でヘッダーと本文を分離（空行で区切られる）
				const partSections = part.split('\r\n\r\n');
				if (partSections.length < 2) continue;

				const partHeader = partSections[0];
				let textContent = partSections.slice(1).join('\r\n\r\n');

				let encoding = 'none';
				let charset = 'utf-8';

				// エンコーディングを確認
				if (partHeader.includes('Content-Transfer-Encoding: quoted-printable')) {
					encoding = 'quoted-printable';
				} else if (partHeader.includes('Content-Transfer-Encoding: base64')) {
					encoding = 'base64';
				}
				if (partHeader.includes('charset="iso-2022-jp"')) {
					charset = 'iso-2022-jp';
				} else if (partHeader.includes('charset="utf-8"') || partHeader.includes('charset=utf-8')) {
					charset = 'utf-8';
				}

				// エンコーディングデコード
				if (encoding === 'quoted-printable') {
					textContent = decodeQuotedPrintable(textContent);
				} else if (encoding === 'base64') {
					textContent = decodeBase64(textContent);
				}

				// 文字セットデコード
				if (charset === 'iso-2022-jp') {
					textContent = decodeISO2022JP(textContent);
				}

				return textContent.trim();
			}
		}
	}

	// シンプルなtext/plainメールの場合
	let textContent = bodyPart.trim();

	// エンコーディングデコード
	if (headerPart.includes('Content-Transfer-Encoding: quoted-printable')) {
		textContent = decodeQuotedPrintable(textContent);
	} else if (headerPart.includes('Content-Transfer-Encoding: base64')) {
		textContent = decodeBase64(textContent);
	}

	// 文字セットデコード
	if (headerPart.includes('charset="iso-2022-jp"')) {
		textContent = decodeISO2022JP(textContent);
	}

	return textContent;
}

const decodeQuotedPrintable = (text: string): string => {
	return text
		.replace(/=\r\n/g, '') // ソフト改行を削除
		.replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const decodeBase64 = (text: string): string => {
	try {
		// 改行やスペースを削除
		const cleanedText = text.replace(/\s/g, '');
		// Base64デコード
		const decoded = atob(cleanedText);
		// UTF-8として解釈
		return new TextDecoder('utf-8').decode(new Uint8Array([...decoded].map(c => c.charCodeAt(0))));
	} catch (error) {
		console.error('Base64 decode error:', error);
		return text; // デコードに失敗した場合は元のテキストを返す
	}
}

const decodeISO2022JP = (text: string): string => {
	// ISO-2022-JPの基本的なエスケープシーケンス処理
	return text
		.replace(/\x1B\$B([^\x1B]*)\x1B\(B/g, (match, p1) => {
			// JIS X 0208の文字をUnicodeに変換
			let result = '';
			for (let i = 0; i < p1.length; i += 2) {
				if (i + 1 < p1.length) {
					const byte1 = p1.charCodeAt(i);
					const byte2 = p1.charCodeAt(i + 1);
					// 簡易的なJIS->Unicode変換
					const code = ((byte1 - 0x21) * 94) + (byte2 - 0x21) + 0x2121;
					if (code >= 0x2121 && code <= 0x7426) {
						// よく使われる文字の変換テーブル
						const char = convertJISToUnicode(byte1, byte2);
						result += char;
					}
				}
			}
			return result;
		})
		.replace(/\x1B\([BJ]/g, ''); // ASCII復帰シーケンスを削除
}

const convertJISToUnicode = (byte1: number, byte2: number): string => {
	// 簡易的な変換テーブル（よく使われる文字のみ）
	const jisToUnicode: { [key: string]: string } = {
		'%F': 'テ',
		'%9': 'ス',
		'%H': 'ト',
		'K\\': '本',
		'J8': '文'
	};

	const key = String.fromCharCode(byte1) + String.fromCharCode(byte2);
	return jisToUnicode[key] || key;
}