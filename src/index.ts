import PostalMime from "postal-mime";

export default {
	async email(message, env, ctx) {
		const webhookUrl = env.DISCORD_WEBHOOK_URL;
		const email = await PostalMime.parse(message.raw)
		const subject = email.subject || message.headers.get('subject')
		const body = email.text || "本文なし"
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