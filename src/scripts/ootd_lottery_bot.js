/**
 * OOTD Weekly Lottery Bot
 * 功能：自动抓取持币用户 -> 随机抽奖 -> 发放代币
 * 运行环境：Node.js / GitHub Actions
 */

require('dotenv').config();
const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58'); // 用于解析私钥
const crypto = require('crypto'); // 引入加密库用于更安全的随机数

// --- 1. 配置区域 (Configuration) ---

// 建议使用 Helius 或 QuickNode 的免费 RPC，公共节点(api.mainnet-beta)容易限流失败
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'; 

// ✅ 已更新：您的真实代币合约地址 (CA)
const OOTD_MINT_ADDRESS = new PublicKey('DY655y1CFNBo6i1ZQVpo2ViUqbGy4tba23L2ME5Apump'); 

// ⚠️ 重要：请去 Solscan 确认您的代币精度 (Decimals)
// 大多数 Solana 代币是 9，少数是 6。填错会导致发币数量差 1000 倍！
const DECIMALS = 9; 

const PRIZE_AMOUNT = 1; // 每人奖金数量 (比如 1000 个 OOTD)
const WINNERS_COUNT = 1;   // 每周抽取多少人

// 项目方钱包（发奖者）私钥 - 从环境变量读取，不要直接写在这里！
const PAYER_SECRET_KEY = process.env.PAYER_PRIVATE_KEY; 

// --- 2. 核心功能函数 ---

async function main() {
    console.log(`[${new Date().toISOString()}] 🚀 OOTD 周二抽奖程序启动...`);

    if (!PAYER_SECRET_KEY) {
        console.error('❌ 错误：未找到 PAYER_PRIVATE_KEY。');
        console.error('👉 请在 .env 文件中设置 PAYER_PRIVATE_KEY=您的私钥');
        process.exit(1);
    }

    // 初始化连接
    const connection = new Connection(RPC_URL, 'confirmed');
    let payer;
    try {
        payer = Keypair.fromSecretKey(bs58.decode(PAYER_SECRET_KEY));
    } catch (e) {
        console.error('❌ 私钥格式错误，请确保是 Base58 字符串 (即 Phantom 钱包导出的格式)。');
        process.exit(1);
    }
    
    console.log(`身份验证成功: 发奖账户为 ${payer.publicKey.toString()}`);

    // --- 步骤 A: 获取所有持币者 (Snapshot) ---
    console.log('📸 正在进行链上快照，获取所有持币者...');
    
    // 注意：如果是生产环境且用户量大(>1000人)，getParsedProgramAccounts 可能会超时
    // 此时建议使用 Helius DAS API (getAssetsByGroup)
    let accounts;
    try {
        accounts = await connection.getParsedProgramAccounts(
            TOKEN_PROGRAM_ID, 
            {
                filters: [
                    { dataSize: 165 }, // Token Account size
                    { memcmp: { offset: 0, bytes: OOTD_MINT_ADDRESS.toBase58() } } // 筛选特定代币
                ]
            }
        );
    } catch (e) {
        console.error('❌ 获取持币用户失败，请检查 RPC 节点限制。建议在 .env 换一个 RPC_URL。', e);
        return;
    }

    const holders = [];
    for (const acc of accounts) {
        const parsedAccountInfo = acc.account.data.parsed.info;
        const amount = parsedAccountInfo.tokenAmount.uiAmount;
        const owner = parsedAccountInfo.owner;

        // 过滤规则：
        // 1. 余额必须大于 0
        // 2. 不是发奖账户自己 (自己抽自己没意义)
        // 3. (可选) 排除流动性池地址 (Raydium Pool)，防止发给池子
        if (amount > 0 && owner !== payer.publicKey.toString()) {
            holders.push(owner);
        }
    }

    console.log(`✅ 快照完成！当前合格持币者人数: ${holders.length}`);

    if (holders.length === 0) {
        console.log('❌ 没有找到合格的持币者，程序结束。');
        return;
    }

    // --- 步骤 B: 随机抽奖 (Lottery) ---
    console.log(`🎲 正在从 ${holders.length} 人中抽取 ${WINNERS_COUNT} 名幸运儿...`);
    const winners = [];
    const tempHolders = [...holders];
    
    // 使用 crypto.randomInt 进行更安全的随机抽取
    const drawCount = Math.min(WINNERS_COUNT, tempHolders.length);
    
    for (let i = 0; i < drawCount; i++) {
        const randomIndex = crypto.randomInt(0, tempHolders.length);
        winners.push(tempHolders[randomIndex]);
        tempHolders.splice(randomIndex, 1); // 移除已中奖者，避免重复
    }

    console.log('🏆 本周中奖名单:', winners);

    // --- 步骤 C: 发放空投 (Airdrop) ---
    console.log('💸 正在构建转账交易...');
    
    // 获取发奖者的代币账户 (Source)
    let fromTokenAccount;
    try {
        fromTokenAccount = await getAssociatedTokenAddress(
            OOTD_MINT_ADDRESS,
            payer.publicKey
        );
    } catch (e) {
        console.error('❌ 无法获取发奖者代币账户地址，请确保发奖钱包里有 OOTD 代币！');
        return;
    }

    // 分批处理交易，每批 5 个指令，避免交易过大
    const BATCH_SIZE = 5;
    for (let i = 0; i < winners.length; i += BATCH_SIZE) {
        const batchWinners = winners.slice(i, i + BATCH_SIZE);
        const transaction = new Transaction();
        
        console.log(`正在处理第 ${Math.floor(i/BATCH_SIZE) + 1} 批次交易...`);

        for (const winner of batchWinners) {
            const winnerPubkey = new PublicKey(winner);
            
            // 获取中奖者的 ATA 地址 (目标地址)
            // 因为是从 holder 列表中选出的，他们一定有 ATA 账户，不需要创建
            const toTokenAccount = await getAssociatedTokenAddress(
                OOTD_MINT_ADDRESS,
                winnerPubkey
            );

            // 计算金额 (处理精度)
            // 金额 = 数量 * 10^精度
            const amountBigInt = BigInt(PRIZE_AMOUNT) * BigInt(10 ** DECIMALS);

            transaction.add(
                createTransferInstruction(
                    fromTokenAccount,
                    toTokenAccount,
                    payer.publicKey,
                    amountBigInt
                )
            );
        }

        // 发送交易
        try {
            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [payer],
                { skipPreflight: false, preflightCommitment: 'confirmed' }
            );
            console.log(`✅ 批次空投成功！交易哈希: https://solscan.io/tx/${signature}`);
        } catch (err) {
            console.error('❌ 交易失败 (可能余额不足或网络拥堵):', err);
        }
    }
    
    console.log("🎉 所有操作执行完毕。");
}

main();