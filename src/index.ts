import PostalMime, { Email } from "postal-mime";
import { createHash } from "node:crypto";

export default {
	async email(message, env, ctx) {
		const webhookUrl = env.DISCORD_WEBHOOK_URL;
		const email = await PostalMime.parse(message.raw)
		const data = buildDiscordContent(email, message);

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

const buildDiscordContent = (email: Email, message: ForwardableEmailMessage) => {
	const subject = email.subject || message.headers.get('subject')
	const body = email.text || "本文なし"
	const emailFrom = email.from.address || message.from.toString() || "不明";
	const emailTo = email.to?.join(",") || message.to.toString() || "不明";

	const md5Hash = email && createHash("md5").update(emailFrom).digest("hex");
	const iconUrl =
		md5Hash && `https://www.gravatar.com/avatar/${md5Hash}?d=identicon`;

	const data = {
		"avarar_url": iconUrl,
		"username": `${email.from.name || "不明"} <${email.from.address || "不明"}>`,
		"embeds": [
			{
				"title": subject || "件名なし",
				"description": body || "本文なし",
				"color": 0x00ff00, // 緑色
				"footer": {
					"text": `From: ${emailFrom} To: ${emailTo}`,
				},
				"timestamp": new Date().toISOString()
			}
		]
	}
	return data;
}