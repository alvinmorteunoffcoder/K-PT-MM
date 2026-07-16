import { Telegraf } from 'telegraf';
import 'dotenv/config';
import prisma from '../src/db';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

const UPGRADE_MESSAGE = `
🎉 *Massive Update to Your Expense Tracker Bot!* 🎉

We have just deployed some huge upgrades to make tracking your finances even easier!

*Here is what's new:*

1️⃣ **Wallet IDs**: No more typing long wallet names! Every wallet now has a simple ID (1, 2, 3...). Check your IDs with \`/acc\` and use them directly:
Example: \`+500 Salary @ 1\` or \`-100 Food @ 2\`

2️⃣ **New \`/exp\` Command**: Check your overall incomes and expenses!
Example: \`/exp\` (Overall) or \`/exp @ 1\` (Specific Wallet)

3️⃣ **Auto-Reset for Empty Wallets**: If your wallet balance drops below ₹3, the income and expenses for that wallet will secretly reset to ₹0 in \`/exp\` to start fresh! (Your transaction history will NOT be deleted and remains safe in \`/his\`).

4️⃣ **Smarter \`/bal\`**: The \`/bal\` command is now much cleaner and strictly shows your balances!

5️⃣ **Smarter AI Assistant**: The \`/ai\` command is now more stable and faster than ever!

Start exploring the new features now! If you have any questions, use \`/help\`. Happy Tracking! 🚀
`;

async function notifyUsers() {
  try {
    console.log("Fetching all unique users...");
    const users = await prisma.user.findMany();
    
    console.log(`Found ${users.length} users. Starting broadcast...`);
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.id.toString(), UPGRADE_MESSAGE, { parse_mode: 'Markdown' });
        console.log(`✅ Sent to user ${user.id}`);
        successCount++;
      } catch (err: any) {
        console.error(`❌ Failed to send to user ${user.id}: ${err.message}`);
        failCount++;
      }
      // Delay to avoid hitting Telegram's rate limits (30 messages per second)
      await new Promise(res => setTimeout(res, 50));
    }

    console.log(`\nBroadcast complete!`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${failCount}`);
  } catch (error) {
    console.error("Error during broadcast:", error);
  } finally {
    process.exit(0);
  }
}

notifyUsers();
