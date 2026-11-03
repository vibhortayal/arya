# Alexa skill: Amazon developer console steps (owner)

Private to this project. Not in the repo. Nothing goes live until Ops sets `ARYA_ALEXA=1` on the VM.

You can do steps 1 to 6 now. Step 7 (testing) needs the backend deployed with the flag on.

## 1. Create the skill
- In the Alexa developer console, choose **Create Skill**.
- Skill name: **Arya**. Primary locale: **English (US)**.
- Type of experience: **Other**. Model: **Custom**.
- Hosting service: **Provision your own**.
- Template: **Start from scratch**. Then **Create skill**.

## 2. Invocation name
- Go to **Build > Invocations > Skill Invocation Name**.
- Enter **my arya**. Amazon refuses one-word names such as plain "arya" unless you can prove you own the brand.
- You then say: "Alexa, ask my arya to add milk".
- If Alexa often mishears it (for example as "maria" or "my area"), test it in step 7 first. A backup is "arya shopper".

## 3. Interaction model
- Go to **Build > Interaction Model > JSON Editor**.
- Replace everything with the contents of `/mnt/project-files/alexa/interaction-model.json`.
- Choose **Save**, then **Build skill**. The build takes about a minute.

## 4. Endpoint
- Go to **Build > Endpoint**.
- Select **HTTPS**.
- Default Region: `https://arya.teamnightshift.org/alexa/skill`
- Certificate: **My development endpoint has a certificate from a trusted certificate authority**. The site uses a Let's Encrypt certificate.
- Choose **Save**.
- Copy the **Skill ID** (`amzn1.ask.skill....`) shown on this page. **Copy back: Skill ID** (it is not a secret).

## 5. Account linking
Go to **Build > Tools > Account Linking** and fill it in as follows:
- **Do you allow users to create an account or link to an existing account with you?** On.
- **Allow users to enable skill without account linking:** Off.
- **Allow users to link their account to your skill from within your application or website:** Off.
- **Authorization Grant Type:** Auth Code Grant.
- **PKCE:** Off.
- **Your Web Authorization URI:** `https://arya.teamnightshift.org/alexa/authorize`
- **Access Token URI:** `https://arya.teamnightshift.org/alexa/token`
- **Your Client ID:** `arya-alexa`
- **Your Secret:** make a long random password in your password manager (at least 32 characters) and paste it here. **Never put it in chat.**
- **Your Authentication Scheme:** HTTP Basic (Recommended). The server also accepts credentials in the request body.
- **Scope:** add one scope, `lists`.
- **Domain List:** leave empty.
- **Default Access Token Expiration Time:** `3600`

Choose **Save**.

At the bottom of the page, Amazon shows the **Alexa Redirect URLs**: three addresses starting with `https://pitangui.amazon.com/...`, `https://layla.amazon.com/...` and `https://alexa.amazon.co.jp/...`. **Copy back: all three Redirect URLs** (they are not secrets).

## 6. Put the values on the VM
Add these lines to `deploy/.env` on the VM, in the same file that holds the other keys. Type the secret there yourself, or have Ops open the file for you. Do not paste it in chat.

```
ARYA_ALEXA=1
ARYA_ALEXA_CLIENT_ID=arya-alexa
ARYA_ALEXA_CLIENT_SECRET=<the secret from step 5>
ARYA_ALEXA_SKILL_ID=<Skill ID from step 4>
ARYA_ALEXA_REDIRECTS=<the three Redirect URLs, comma separated, no spaces>
```

Ops then restarts the API. `ARYA_ALEXA=1` is what turns the skill on. Leave it at 0 (or leave it out) to keep everything hidden.

## 7. Test (after Ops has deployed the PR and set the flag)
1. In the console, go to **Test** and set **Skill testing is enabled in** to **Development**.
2. In the Alexa app on your phone, go to **More > Skills & Games > Your Skills > Dev**, open **Arya**, and tap **Enable to use**. Arya's page opens. Sign in if asked, then tap **Allow**.
3. Say or type in the simulator: "ask my arya to add bananas to costco". Alexa should answer "Added Bananas to Costco." (or the name your list uses).
4. Try a misheard name: "ask my arya to add nan to costco see". Alexa answers "Sent to Arya." The item appears on the list a few seconds later.

Development mode only works on your own Amazon account. Certification is not needed for this.
