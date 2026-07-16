import { Telegraf } from 'telegraf';
import 'dotenv/config';
import prisma from './db';
import http from 'http';
import { GoogleGenerativeAI } from '@google/generative-ai';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN as string);

function formatINR(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function resolveAccount(userId: number | bigint, identifier: string) {
  const accounts = await prisma.account.findMany({
    where: { userId: BigInt(userId) },
    orderBy: { createdAt: 'asc' }
  });

  const parsedId = parseInt(identifier);
  if (!isNaN(parsedId) && parsedId > 0 && parsedId <= accounts.length) {
    return accounts[parsedId - 1];
  }

  const acc = accounts.find(a => a.name.toLowerCase() === identifier.toLowerCase());
  return acc || null;
}

const WELCOME_MESSAGE = `
👋 *Welcome to your Personal Expense Tracker!*

I am here to help you effortlessly manage your finances. With me, you can track your incomes, expenses, and multiple accounts directly from Telegram!

*Here is how to use me:*

⚡ **1. Fast Logging (No slashes needed!)**
Just type your transaction naturally:
• Expense: \`-2500 Food\`
• Income: \`+50000 Salary\`
• Specific Account: \`-1000 Petrol @ 1\` (or \`@ Wallet Name\`)

📊 **2. Core Commands**
• /bal - Check balances across all your accounts.
• /exp - Check your incomes and expenses.
• /acc - View your list of accounts and their IDs.
• /his - View your recent transaction history.
• /ai <question> - Ask your AI financial assistant anything!

🏦 **3. Management Commands**
• /ca <name> - Create a new account.
• /ea <old name or ID> @ <new name> - Rename an account.
• /da <name or ID> - Delete an account (and its history).
• /et <ID> <+ or -><amount> <category> [@ account ID/name] - Edit a transaction.
• /dt <ID> - Delete a transaction.

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
    const accounts = await prisma.account.findMany({ 
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'asc' }
    });
    if (accounts.length === 0) {
      return ctx.reply("You don't have any accounts. Use /start to create a default one.");
    }
    
    let totalBalance = 0;
    let message = "💰 *Your Summary:*\n\n";
    
    for (const acc of accounts) {
      message += `*${acc.name}*\n`;
      message += `• Balance: ₹${formatINR(acc.balance)}\n\n`;
      totalBalance += acc.balance;
    }
    
    message += `*Overall Balance:* ₹${formatINR(totalBalance)}`;
    
    ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error(error);
    ctx.reply("Error fetching balances.");
  }
});

// /exp [@ account] - Check expenses and incomes
bot.command('exp', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/exp', '').trim();
  const identifier = text.startsWith('@') ? text.substring(1).trim() : text;

  try {
    const accounts = await prisma.account.findMany({ 
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'asc' },
      include: { transactions: true }
    });

    if (accounts.length === 0) {
      return ctx.reply("You don't have any accounts.");
    }

    let targetAccounts = accounts;
    let title = "📊 *Overall Incomes & Expenses:*\n\n";
    let isSpecific = false;

    if (identifier) {
      const parsedId = parseInt(identifier);
      let foundAccount = null;
      if (!isNaN(parsedId) && parsedId > 0 && parsedId <= accounts.length) {
        foundAccount = accounts[parsedId - 1];
      } else {
        foundAccount = accounts.find(a => a.name.toLowerCase() === identifier.toLowerCase());
      }

      if (!foundAccount) {
        return ctx.reply(`Account '${identifier}' not found.`);
      }
      targetAccounts = [foundAccount];
      title = `📊 *Incomes & Expenses for ${foundAccount.name}:*\n\n`;
      isSpecific = true;
    }
    
    let totalIncome = 0;
    let totalExpense = 0;

    for (const acc of targetAccounts) {
      const validTransactions = acc.lastResetAt 
        ? acc.transactions.filter(t => t.date >= acc.lastResetAt!)
        : acc.transactions;

      const inc = validTransactions.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
      const exp = validTransactions.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
      
      totalIncome += inc;
      totalExpense += exp;
    }

    let message = title;
    message += `• Overall Income: ₹${formatINR(totalIncome)}\n`;
    message += `• Overall Expenses: ₹${formatINR(totalExpense)}\n`;

    if (isSpecific && targetAccounts[0].lastResetAt) {
       message += `\n_(Note: Income/Expenses reset to zero at ${targetAccounts[0].lastResetAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata'})} because balance dropped below ₹3)_`;
    }

    ctx.replyWithMarkdown(message);
  } catch (error) {
    console.error(error);
    ctx.reply("Error fetching expenses.");
  }
});

// /acc - View accounts
bot.command('acc', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const accounts = await prisma.account.findMany({ 
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'asc' }
    });
    if (accounts.length === 0) return ctx.reply("You have no accounts.");
    
    let message = "🏦 *Your Accounts:*\n\n";
    accounts.forEach((acc, index) => {
      message += `${index + 1}. ${acc.name} (ID: ${index + 1})\n`;
    });
    message += `\nTo create a new account, use: /ca <name>\nYou can use IDs instead of names in commands! (e.g. \`@ 1\`)`;
    
    ctx.replyWithMarkdown(message);
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
    ctx.reply(`Account '${name}' created successfully! Check /acc to see its ID.`);
  } catch (error) {
    ctx.reply(`Error creating account. It might already exist.`);
  }
});

// /ea <old_name_or_id> @ <new_name> - Edit account
bot.command('ea', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text.replace('/ea', '').trim();
  const parts = text.split('@');
  if (parts.length !== 2) return ctx.reply("Usage: /ea <old name or ID> @ <new name>");
  
  const oldIdentifier = parts[0].trim();
  const newName = parts[1].trim();

  try {
    const account = await resolveAccount(userId, oldIdentifier);
    if (!account) return ctx.reply(`Account '${oldIdentifier}' not found.`);

    await prisma.account.update({
      where: { id: account.id },
      data: { name: newName }
    });
    ctx.reply(`Account renamed to '${newName}'!`);
  } catch (error) {
    ctx.reply("Error renaming account.");
  }
});

// /da <name_or_id> - Delete account
bot.command('da', async (ctx) => {
  const userId = ctx.from.id;
  const identifier = ctx.message.text.replace('/da', '').trim();
  if (!identifier) return ctx.reply("Usage: /da <account name or ID>");

  try {
    const account = await resolveAccount(userId, identifier);
    if (!account) return ctx.reply(`Account '${identifier}' not found.`);

    if (account.name.toLowerCase() === 'main wallet') {
      return ctx.reply("You cannot delete the 'Main Wallet' account.");
    }

    await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { accountId: account.id } }),
      prisma.account.delete({ where: { id: account.id } })
    ]);
    
    ctx.reply(`Account '${account.name}' and all its transactions have been deleted. Wallet IDs have been updated.`);
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

  // Match something like "-2500 Food" or "+2500 Salary @ 1"
  const match = text.match(/^([+-])(\d+(?:\.\d+)?)\s+([^@]+)(?:\s+@\s+(.+))?$/);
  
  if (match) {
    const sign = match[1];
    const amount = parseFloat(match[2]);
    const category = match[3].trim();
    const accountIdentifier = match[4] ? match[4].trim() : 'Main Wallet';
    const type = sign === '+' ? 'INCOME' : 'EXPENSE';

    try {
      const account = await resolveAccount(userId, accountIdentifier);
      if (!account) return ctx.reply(`Account '${accountIdentifier}' not found.`);

      await prisma.$transaction(async (prismaTx) => {
        await prismaTx.transaction.create({
          data: {
            accountId: account.id,
            type,
            amount,
            category,
            description: ''
          }
        });

        const updatedAccount = await prismaTx.account.update({
          where: { id: account.id },
          data: { balance: type === 'INCOME' ? { increment: amount } : { decrement: amount } }
        });

        if (updatedAccount.balance < 3.0) {
           await prismaTx.account.update({
             where: { id: account.id },
             data: { lastResetAt: new Date() }
           });
        }
      });

      if (type === 'INCOME') {
        ctx.reply(`✅ Income recorded! +₹${formatINR(amount)} from ${category} (to ${account.name}).`);
      } else {
        ctx.reply(`📉 Expense recorded! -₹${formatINR(amount)} for ${category} (from ${account.name}).`);
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
  const text = ctx.message.text.replace('/his', '').trim();
  const identifier = text.startsWith('@') ? text.substring(1).trim() : text;

  try {
    let accountIds: number[] = [];
    
    if (identifier) {
      const account = await resolveAccount(userId, identifier);
      if (!account) return ctx.reply(`Account '${identifier}' not found.`);
      accountIds = [account.id];
    } else {
      const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
      accountIds = accounts.map(a => a.id);
    }

    const transactions = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { date: 'desc' },
      take: 10,
      include: { account: true }
    });

    if (transactions.length === 0) return ctx.reply("No transactions found.");

    let message = identifier ? `📝 *Recent Transactions for ${transactions[0].account.name}:*\n\n` : "📝 *Recent Transactions:*\n\n";
    for (const t of transactions) {
      const sign = t.type === 'INCOME' ? '+' : '-';
      message += `\`[ID:${t.id}]\` ${t.date.toISOString().split('T')[0]} | ${t.account.name}\n`;
      message += `${sign}₹${formatINR(t.amount)} - ${t.category}\n\n`;
    }
    
    message += "To edit a transaction, use: /et <ID> <+ or -><amount> <category> [@ account ID/name]";
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
  
  const match = text.match(/^(\d+)\s+([+-])(\d+(?:\.\d+)?)\s+([^@]+)(?:\s+@\s+(.+))?$/);
  
  if (!match) return ctx.reply("Usage: /et <ID> <+ or -><amount> <category> [@ account ID/name]");
  
  const id = parseInt(match[1]);
  const sign = match[2];
  const newAmount = parseFloat(match[3]);
  const newCategory = match[4].trim();
  const newAccountIdentifier = match[5] ? match[5].trim() : null;
  const newType = sign === '+' ? 'INCOME' : 'EXPENSE';

  try {
    const accounts = await prisma.account.findMany({ where: { userId: BigInt(userId) } });
    const accountIds = accounts.map(a => a.id);
    
    const oldTx = await prisma.transaction.findUnique({
      where: { id },
      include: { account: true }
    });

    if (!oldTx || !accountIds.includes(oldTx.accountId)) {
      return ctx.reply("Transaction not found.");
    }

    let targetAccount = oldTx.account;
    if (newAccountIdentifier) {
      const found = await resolveAccount(userId, newAccountIdentifier);
      if (!found) return ctx.reply(`Account '${newAccountIdentifier}' not found.`);
      targetAccount = found;
    }

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
      
      // Auto reset checks
      const updatedOld = await prismaTx.account.findUnique({ where: { id: oldTx.accountId } });
      if (updatedOld && updatedOld.balance < 3.0) {
        await prismaTx.account.update({ where: { id: updatedOld.id }, data: { lastResetAt: new Date() } });
      }
      
      if (targetAccount.id !== oldTx.accountId) {
        const updatedNew = await prismaTx.account.findUnique({ where: { id: targetAccount.id } });
        if (updatedNew && updatedNew.balance < 3.0) {
          await prismaTx.account.update({ where: { id: updatedNew.id }, data: { lastResetAt: new Date() } });
        }
      }
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
      
      // Auto reset check
      const updatedAccount = await prismaTx.account.findUnique({ where: { id: tx.accountId } });
      if (updatedAccount && updatedAccount.balance < 3.0) {
        await prismaTx.account.update({ where: { id: updatedAccount.id }, data: { lastResetAt: new Date() } });
      }
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

// /ai <question> - AI Financial Assistant
bot.command('ai', async (ctx) => {
  const userId = ctx.from.id;
  const prompt = ctx.message.text.replace('/ai', '').trim();
  
  if (!prompt) {
    return ctx.reply("Please ask a question! For example: /ai how much did I spend on food?");
  }

  if (!process.env.GEMINI_API_KEY) {
    return ctx.reply("AI is not configured. Please set the GEMINI_API_KEY environment variable.");
  }

  try {
    const processingMsg = await ctx.reply("🤔 *Analyzing your finances...*", { parse_mode: "Markdown" });

    // Fetch user's accounts
    const accounts = await prisma.account.findMany({ 
      where: { userId: BigInt(userId) },
      orderBy: { createdAt: 'asc' }
    });

    if (accounts.length === 0) {
      return ctx.reply("You don't have any accounts or transactions yet to analyze.");
    }
    
    const accountIds = accounts.map(a => a.id);
    
    // Fetch only the LAST 50 transactions to prevent memory/context overload
    const recentTransactions = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { date: 'desc' },
      take: 50,
      include: { account: true }
    });

    let txData = "User's financial data (Latest 50 transactions only to save context limits):\n\n";
    
    // Summary of balances
    for (let i = 0; i < accounts.length; i++) {
       txData += `Account: ${accounts[i].name} (ID: ${i + 1}) - Balance: ₹${accounts[i].balance}\n`;
    }
    txData += "\nRecent Transactions:\n";
    
    for (const t of recentTransactions) {
      const sign = t.type === 'INCOME' ? '+' : '-';
      txData += `${t.date.toISOString().split('T')[0]} | Account: ${t.account.name} | ${t.category} | ${sign}₹${t.amount}\n`;
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // updated model name for safety
    
    const finalPrompt = `
      You are a helpful and extremely intelligent personal finance assistant in a Telegram bot.
      Your name is "dood". Introduce yourself as dood if asked.
      You are happy to chat casually with the user (e.g. "hi how are you?") and answer general finance questions.
      You also have access to the user's transaction data below. 
      Answer questions about their finances accurately based ONLY on this data. 
      
      If the user asks how to use the bot or check things, here are the bot's commands:
      - Log Expense: type "-1500 Food @ 1" (1 is the Wallet ID)
      - Log Income: type "+50000 Salary"
      - /bal : Check total balances
      - /exp : Check total incomes & expenses
      - /his : See transaction history
      - /ca : Create account
      - /dt <ID> : Delete a specific transaction
      - /da <Account> : Delete an account and all its transactions
      
      If the user asks to clear, delete, or reset their transactions, politely explain that you (the AI) cannot do that directly, but they can use the /dt or /da commands to do it themselves.
      
      Format your response beautifully with markdown, emojis, and a highly friendly, conversational tone. Do not expose internal IDs unless instructing them to use /dt.
      If the user asks something completely unrelated to finance or casual greetings, politely redirect them.
      
      ${txData}
      
      User's Question: "${prompt}"
    `;

    const result = await model.generateContent(finalPrompt);
    const text = result.response.text();

    await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    ctx.replyWithMarkdown(text);
  } catch (error) {
    console.error("AI Error:", error);
    ctx.reply("Sorry, I had trouble analyzing that. Please try again later!");
  }
});

bot.catch((err, ctx) => {
  console.error(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

const PORT = Number(process.env.PORT) || 3000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL;

if (WEBHOOK_URL) {
  const secretPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${WEBHOOK_URL}${secretPath}`);
  
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200);
      res.end('Bot is awake and ready!');
    } else {
      bot.webhookCallback(secretPath)(req, res);
    }
  });

  server.listen(PORT, () => {
    console.log(`Bot is running in Webhook mode at ${WEBHOOK_URL} on port ${PORT}`);
  });
} else {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running in polling mode!');
  });
  
  server.listen(PORT, () => {
    console.log(`Dummy health-check server listening on port ${PORT}`);
  });

  bot.launch({ dropPendingUpdates: true }).then(() => {
    console.log("Bot is running in Polling mode...");
  }).catch((err) => {
    console.error("Failed to start bot in Polling mode:", err);
  });

  process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
  });
}
