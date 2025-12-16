/**
 * OOTD 自动抽奖机器人 (最终稳定版 V2)
 * 包含：bs58修复、多节点重试、真实合约地址、结果保存功能
 */
require('dotenv').config();
const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const crypto = require('crypto');
const fs = require('fs');
const bs58 = require('bs58');

// --- 🔧 1. 兼容性修复 (解决 bs58 is not a function) ---
const decode = bs58.decode || (bs58.default ? bs58.default.decode : null);
if (!decode) { 
    console.error("❌ 错误：无法加载 bs58 解码库。"); 
    process.exit(1); 
}

// --- ⚙️ 2. 核心配置区域 ---

// ✅ 您的真实代币合约地址
const OOTD_MINT_ADDRESS = new PublicKey('DY655y1CFNBo6i1ZQVpo2ViUqbGy4tba23L2ME5Apump');

// ⚠️ 代币精度 (请确保与 Solscan 一致，通常是 6 或 9)
const DECIMALS = 6; 

// 💰 奖金设置 (当前为正式版配置)
// 如果想测试，请改为 PRIZE_AMOUNT = 0.1 和 WINNERS_COUNT = 1
const PRIZE_AMOUNT = 1000; // 每人奖励数量
const WINNERS_COUNT = 5;   // 抽取人数

// 私钥 (从 .env 文件读取)
const PAYER_SECRET_KEY = process.env.PAYER_PRIVATE_KEY;

// 🌐 备用节点列表 (智能防断连)
// 程序会自动按顺序尝试连接，直到成功为止
const RPC_ENDPOINTS = [
    process.env.RPC_URL, // 优先使用您在 .env 里配置的节点 (如 Helius)
    'https://api.mainnet-beta.solana.com', // 官方节点 (慢但稳)
    'https://solana-api.projectserum.com', // 备用节点
    'https://rpc.ankr.com/solana'          // Ankr 公共节点
].filter(Boolean); // 过滤掉空值

// --- 🛠 工具函数 ---

// 自动寻找可用的 RPC 连接
async function getWorkingConnection() {
    console.log("🔍 正在寻找可用的 Solana 节点...");
    for (const rpc of RPC_ENDPOINTS) {
        console.log(`   ➡️ 尝试连接: ${rpc}...`);
        try {
            // 设置较短的超时时间用于测试连接
            const conn = new Connection(rpc, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 });
            const version = await conn.getVersion();
            console.log(`   ✅ 连接成功! (节点版本: ${version['solana-core']})`);
            return conn;
        } catch (e) {
            console.warn(`   ⚠️ 连接失败，尝试下一个...`);
        }
    }
    throw new Error("❌ 所有节点都无法连接！请检查网络 (VPN全局模式) 或 .env 配置。");
}

// --- 🚀 主程序 ---

async function main() {
    console.log(`\n[${new Date().toISOString()}] 🚀 OOTD 抽奖程序启动...`);

    // 1. 检查私钥
    if (!PAYER_SECRET_KEY) { 
        console.error("❌ 错误：未找到私钥配置，请检查 .env 文件。");
        process.exit(1); 
    }

    // 2. 获取网络连接
    let connection;
    try {
        connection = await getWorkingConnection();
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }

    // 3. 解析钱包身份
    let payer;
    try {
        if (PAYER_SECRET_KEY.includes('[')) { 
            // 数组格式私钥
            payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(PAYER_SECRET_KEY))); 
        } else { 
            // Base58 字符串格式私钥
            payer = Keypair.fromSecretKey(decode(PAYER_SECRET_KEY)); 
        }
        console.log(`👤 发奖账户地址: ${payer.publicKey.toString()}`);
    } catch (e) { 
        console.error("❌ 私钥格式错误，请确保复制完整。");
        process.exit(1); 
    }

    // 4. 扫描持币者 (快照)
    console.log('📸 正在扫描链上持币用户 (根据网络情况可能需要 1-2 分钟)...');
    let holders = [];
    try {
        // 获取代币的所有账户
        const accounts = await connection.getParsedProgramAccounts(
            TOKEN_PROGRAM_ID, 
            { 
                filters: [
                    { dataSize: 165 }, 
                    { memcmp: { offset: 0, bytes: OOTD_MINT_ADDRESS.toBase58() } } 
                ] 
            }
        );
        
        // 过滤数据：余额大于0 且 不是发奖者自己
        holders = accounts.map(acc => {
            const info = acc.account.data.parsed.info;
            return { owner: info.owner, amount: info.tokenAmount.uiAmount };
        }).filter(h => h.amount > 0 && h.owner !== payer.publicKey.toString())
          .map(h => h.owner);

        console.log(`👥 扫描完成！当前合格持币人数: ${holders.length}`);
    } catch (e) {
        console.error("❌ 扫描失败。可能是节点限流 (429 Too Many Requests)。");
        console.error("👉 建议：如果在本地，请开全局代理；稍等 1 分钟再试。");
        return;
    }

    if (holders.length === 0) {
        console.log("⚠️ 警告：找到了 0 个持币者。");
        console.log("👉 请确认：1. 您是否已购买代币？ 2. 代币是否在钱包中(而非Pump曲线中)？");
        return;
    }

    // 5. 随机抽奖
    console.log(`🎲 正在从 ${holders.length} 人中抽取 ${WINNERS_COUNT} 名幸运儿...`);
    const winners = [];
    const tempHolders = [...holders];
    
    // 防止人数不足
    const actualWinnerCount = Math.min(WINNERS_COUNT, tempHolders.length);
    
    for (let i = 0; i < actualWinnerCount; i++) {
        const idx = crypto.randomInt(0, tempHolders.length);
        winners.push(tempHolders[idx]);
        tempHolders.splice(idx, 1); // 移除已中奖者，避免重复
    }
    console.log('🏆 本期中奖名单:', winners);

    // 6. 执行转账 (批量打包)
    console.log('💸 正在构建并发送交易...');
    try {
        // 获取发奖者的代币账户 (Source)
        const fromTokenAccount = await getAssociatedTokenAddress(OOTD_MINT_ADDRESS, payer.publicKey);
        
        const transaction = new Transaction();
        const successfulWinners = [];

        for (const winner of winners) {
            const winnerPubkey = new PublicKey(winner);
            // 获取中奖者的代币账户 (Destination) - 必定存在，因为是从持币列表选的
            const toTokenAccount = await getAssociatedTokenAddress(OOTD_MINT_ADDRESS, winnerPubkey);
            
            // 计算金额：数量 * 10的精度次方
            const amountBigInt = BigInt(Math.floor(PRIZE_AMOUNT * (10 ** DECIMALS)));

            transaction.add(
                createTransferInstruction(
                    fromTokenAccount,
                    toTokenAccount,
                    payer.publicKey,
                    amountBigInt
                )
            );
            successfulWinners.push(winner);
        }

        // 发送交易
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { skipPreflight: false, preflightCommitment: 'confirmed' }
        );
        
        console.log(`✅ 空投发放成功！`);
        console.log(`🔗 交易哈希 (Tx): https://solscan.io/tx/${signature}`);

        // 7. 保存结果到文件 (可选，用于前端读取)
        const resultData = {
            status: "Success",
            lastUpdate: new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }), // 改为您的时区
            txHash: signature,
            winners: successfulWinners,
            totalHolders: holders.length
        };
        
        fs.writeFileSync('lottery_status.json', JSON.stringify(resultData, null, 2));
        console.log("💾 开奖结果已保存至 lottery_status.json");

    } catch (e) {
        console.error('❌ 交易失败:', e.message);
        if (e.message.includes('insufficient funds')) {
            console.error('👉 请检查：1. SOL 余额是否足够付 Gas？ 2. OOTD 代币余额是否足够？');
        }
    }
}

main();
