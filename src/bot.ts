import { Telegraf } from 'telegraf';
import 'dotenv/config';
import prisma from './db';
import http from 'http';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);
// Bot is now public and multi-tenant. Anyone can use it!

const WELCOME_MESSAGE = `
👋 *Welcome to your Personal Expense Tracker!*

I am here to help you effortlessly manage your finances. With me, you can track your incomes, expenses, and multiple accounts directly from Telegram!

*Here is how to use me:*

⚡ **1. Fast Logging (No slashes needed!)**
Just type your transaction naturally:
• Expense: \`-2500 Food\`
• Income: \`+50000 Salary\`
• Specific Account: \`-1000 Petrol @ HDFC Bank\`

📊 **2. Core Commands**
• /bal - Check balances across all your accounts.
• /acc - View your list of accounts.
• /his - View your recent transaction history.

🏦 **3. Management Commands**
• /ca <name> - Create a new account.
• /ea <old> @ <new> - Rename an account.
• /da <name> - Delete an account (and its history).
• /et <id> <+ or -><amount> <category> [@ account] - Edit a transaction.
• /dt <id> - Delete a transaction.

Tap /help anytime to see this message again! Let's get tracking! 🚀
`;


bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || 'User';

  try {
    let user = await prisma.user.findUnique({ where: { id: BigInt(userId) } });
    if (!user) {
      user = await prisma.user.create({ data: { id: BigInt(userId), username } });
    }

    const defaultAccount = await prisma.account.findFirst({
      where: { userId: BigInt(userId), name: 'Main Wallet' }
    });

    if (!defaultAccount) {
      await prisma.account.create({
        data: { userId: BigInt(userId), name: 'Main Wallet', balance: 0.0 }
      });
    }

    ctx.replyWithMarkdown(WELCOME_MESSAGE);
  } catch (error) {
    console.error("Error in /start command:", error);
    ctx.reply("There was an error setting up your profile.");
  }
});

// /bal - Check balances
bot.command('bal', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    if (accounts.length === 0) {
      return ctx.reply("You don't have any accounts. Use /start to create a default one.");
    }
    
    let totalBalance = 0;
    let message = "💰 *Your Balances:*\n\n";
    for (const acc of accounts) {
      message += `- ${acc.name}: ₹${acc.balance.toFixed(2)}\n`;
      totalBalance += acc.balance;
    }
    message += `\n*Total:* ₹${totalBalance.toFixed(2)}`;
    
    ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error(error);
    ctx.reply("Error fetching balances.");
  }
});

// /acc - View accounts
bot.command('acc', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    const accNames = accounts.map(a => a.name).join(', ');
    ctx.reply(`Your accounts: ${accNames}\n\nTo create a new account, use: /ca <name>`);
  } catch(error) {
    ctx.reply("Error fetching accounts.");
  }
});

// /ca <name> - Create account
bot.command('ca', async (ctx) => {
  const userId = ctx.from.id;
  const name = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!name) return ctx.reply("Please provide a name: /ca <name>");

  try {
    await prisma.account.create({
      data: { userId: BigInt(userId), name, balance: 0.0 }
    });
    ctx.reply(`Account '${name}' created successfully!`);
  } catch (error) {
    ctx.reply(`Error creating account. It might already exist.`);
  }
});

// /ea <old_name> @ <new_name> - Edit account
bot.command('ea', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/ea', '').trim();
  const parts = text.split('@');
  if (parts.length !== 2) return ctx.reply("Usage: /ea <old_name> @ <new_name>");
  
  const oldName = parts[0].trim();
  const newName = parts[1].trim();

  try {
    const account = await prisma.account.findFirst({ where: { userId: BigInt(userId), name: oldName } });
    if (!account) return ctx.reply(`Account '${oldName}' not found.`);

    await prisma.account.update({
      where: { id: account.id },
      data: { name: newName }
    });
    ctx.reply(`Account renamed to '${newName}'!`);
  } catch (error) {
    ctx.reply("Error renaming account.");
  }
});

// /da <name> - Delete account
bot.command('da', async (ctx) => {
  const userId = ctx.from.id;
  const name = ctx.message.text.replace('/da', '').trim();
  if (!name) return ctx.reply("Usage: /da <account_name>");

  if (name.toLowerCase() === 'main wallet') {
    return ctx.reply("You cannot delete the 'Main Wallet' account.");
  }

  try {
    const account = await prisma.account.findFirst({ where: { userId: BigInt(userId), name } });
    if (!account) return ctx.reply(`Account '${name}' not found.`);

    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { accountId: account.id } }),
      prisma.account.delete({ where: { id: account.id } })
    ]);
    
    ctx.reply(`Account '${name}' and all its transactions have been deleted.`);
  } catch (error) {
    console.error(error);
    ctx.reply("Error deleting account.");
  }
});

// Listener for "-2500 Food [@ Account]" and "+2500 Salary [@ Account]"
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  const userId = ctx.from.id;

  // Ignore commands
  if (text.startsWith('/')) return next();

  // Match something like "-2500 Food" or "+2500 Salary @ Bank"
  const match = text.match(/^([+-])(\d+(?:\.\d+)?)\s+([^@]+)(?:\s+@\s+(.+))?$/);
  
  if (match) {
    const sign = match[1];
    const amount = parseFloat(match[2]);
    const category = match[3].trim();
    const accountName = match[4] ? match[4].trim() : 'Main Wallet';
    const type = sign === '+' ? 'INCOME' : 'EXPENSE';

    try {
      const account = await prisma.account.findFirst({ where: { userId: BigInt(userId), name: accountName } });
      if (!account) return ctx.reply(`Account '${accountName}' not found.`);

      await prisma.$transaction([
        prisma.transaction.create({
          data: {
            accountId: account.id,
            type,
            amount,
            category,
            description: ''
          }
        }),
        prisma.account.update({
          where: { id: account.id },
          data: { balance: type === 'INCOME' ? { increment: amount } : { decrement: amount } }
        })
      ]);

      if (type === 'INCOME') {
        ctx.reply(`✅ Income recorded! +₹${amount.toFixed(2)} from ${category} (to ${accountName}).`);
      } else {
        ctx.reply(`📉 Expense recorded! -₹${amount.toFixed(2)} for ${category} (from ${accountName}).`);
      }
      return;
    } catch (error) {
      console.error(error);
      ctx.reply("Error recording transaction.");
      return;
    }
  }
  
  return next();
});

// /his - History
bot.command('his', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    const accountIds = accounts.map(a => a.id);

    const transactions = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { date: 'desc' },
      take: 10,
      include: { account: true }
    });

    if (transactions.length === 0) return ctx.reply("No transactions found.");

    let message = "📝 *Recent Transactions:*\n\n";
    for (const t of transactions) {
      const sign = t.type === 'INCOME' ? '+' : '-';
      message += `\`[ID:${t.id}]\` ${t.date.toISOString().split('T')[0]} | ${t.account.name}\n`;
      message += `${sign}₹${t.amount.toFixed(2)} - ${t.category}\n\n`;
    }
    
    message += "To edit a transaction, use: /et <ID> <+ or -><amount> <category> [@ account]";
    ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error(error);
    ctx.reply("Error fetching history.");
  }
});

// /et <id> <+ or -><amount> <category> [@ account] - Edit Transaction
bot.command('et', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/et', '').trim();
  
  // Example: "5 -3000 Groceries @ Bank"
  const match = text.match(/^(\d+)\s+([+-])(\d+(?:\.\d+)?)\s+([^@]+)(?:\s+@\s+(.+))?$/);
  
  if (!match) return ctx.reply("Usage: /et <ID> <+ or -><amount> <category> [@ account]");
  
  const id = parseInt(match[1]);
  const sign = match[2];
  const newAmount = parseFloat(match[3]);
  const newCategory = match[4].trim();
  const newAccountName = match[5] ? match[5].trim() : null;
  const newType = sign === '+' ? 'INCOME' : 'EXPENSE';

  try {
    // 1. Fetch old transaction and verify ownership
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    const accountIds = accounts.map(a => a.id);
    
    const oldTx = await prisma.transaction.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!oldTx || !accountIds.includes(oldTx.accountId)) {
      return ctx.reply("Transaction not found.");
    }

    // 2. Resolve new account
    let targetAccount = oldTx.account;
    if (newAccountName && newAccountName !== oldTx.account.name) {
      const found = await prisma.account.findFirst({ where: { userId: BigInt(userId), name: newAccountName } });
      if (!found) return ctx.reply(`Account '${newAccountName}' not found.`);
      targetAccount = found;
    }

    // 3. Revert old transaction and apply new transaction in a single query transaction
    await prisma.$transaction(async (prismaTx) => {
      // Revert old
      if (oldTx.type === 'INCOME') {
        await prismaTx.account.update({ where: { id: oldTx.accountId }, data: { balance: { decrement: oldTx.amount } }});
      } else {
        await prismaTx.account.update({ where: { id: oldTx.accountId }, data: { balance: { increment: oldTx.amount } }});
      }

      // Apply new
      if (newType === 'INCOME') {
        await prismaTx.account.update({ where: { id: targetAccount.id }, data: { balance: { increment: newAmount } }});
      } else {
        await prismaTx.account.update({ where: { id: targetAccount.id }, data: { balance: { decrement: newAmount } }});
      }

      // Update transaction record
      await prismaTx.transaction.update({
        where: { id },
        data: {
          accountId: targetAccount.id,
          type: newType,
          amount: newAmount,
          category: newCategory
        }
      });
    });

    ctx.reply(`Transaction #${id} updated successfully!`);
  } catch (error) {
    console.error(error);
    ctx.reply("Error updating transaction.");
  }
});

// /dt <id> - Delete Transaction
bot.command('dt', async (ctx) => {
  const userId = ctx.from.id;
  const idStr = ctx.message.text.replace('/dt', '').trim();
  const id = parseInt(idStr);
  
  if (isNaN(id)) return ctx.reply("Usage: /dt <ID>");

  try {
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    const accountIds = accounts.map(a => a.id);
    
    const tx = await prisma.transaction.findUnique({ where: { id } });

    if (!tx || !accountIds.includes(tx.accountId)) {
      return ctx.reply("Transaction not found.");
    }

    await prisma.$transaction(async (prismaTx) => {
      // Revert balance
      if (tx.type === 'INCOME') {
        await prismaTx.account.update({ where: { id: tx.accountId }, data: { balance: { decrement: tx.amount } }});
      } else {
        await prismaTx.account.update({ where: { id: tx.accountId }, data: { balance: { increment: tx.amount } }});
      }

      // Delete record
      await prismaTx.transaction.delete({ where: { id } });
    });

    ctx.reply(`Transaction #${id} has been deleted and balance restored.`);
  } catch (error) {
    console.error(error);
    ctx.reply("Error deleting transaction.");
  }
});

// /hlp or /help - Help
bot.command(['hlp', 'help'], (ctx) => {
  ctx.replyWithMarkdown(WELCOME_MESSAGE);
});

// Create a dummy HTTP server for cloud providers (like Render) that require port binding
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
});

server.listen(PORT, () => {
  console.log(`Dummy health-check server listening on port ${PORT}`);
});

bot.launch().then(() => {
  console.log("Bot is running...");
}).catch((err) => {
  console.error("Failed to start bot:", err);
});

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  server.close();
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  server.close();
});
