/**
 * OOTD 自动抽奖机器人 (正式部署版 - LIVE)
 * ⚠️ 警告：此脚本会消耗真实的 SOL 和 OOTD 代币！
 */
require('dotenv').config();
const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const crypto = require('crypto');
const bs58 = require('bs58');

// --- 🔧 兼容性修复 ---
const decode = bs58.decode || (bs58.default ? bs58.default.decode : null);
if (!decode) {
    console.error("❌ 错误：无法加载 bs58。");
    process.exit(1);
}

// --- 1. 配置区域 (Configuration) ---

// ⚡️ 节点设置 ⚡️
// 推荐使用 Helius/QuickNode 的私有节点以获得最佳稳定性。
// 如果使用公共节点，请务必开启 VPN 全局模式。
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// OOTD 代币合约地址
const OOTD_MINT_ADDRESS = new PublicKey('DY655y1CFNBo6i1ZQVpo2ViUqbGy4tba23L2ME5Apump');

// 代币精度 (请确保与 Solscan 上一致)
const DECIMALS = 6; 

// 💰 奖金设置 (正式版)
const PRIZE_AMOUNT = 1000; // 每人 1000 OOTD
const WINNERS_COUNT = 10;   // 每次抽取 5 人

const PAYER_SECRET_KEY = process.env.PAYER_PRIVATE_KEY;

// --- 2. 主程序 ---
async function main() {
    console.log(`[${new Date().toISOString()}] 🚀 OOTD 正式抽奖程序启动...`);
    console.log(`🌐 节点: ${RPC_URL}`);
    console.log(`💰 计划发放: ${WINNERS_COUNT} 人 x ${PRIZE_AMOUNT} OOTD`);

    // 1. 身份验证
    if (!PAYER_SECRET_KEY) {
        console.error('❌ 错误：未找到私钥，请检查 .env 文件！');
        process.exit(1);
    }

    // 初始化连接 (设置较长超时)
    const connection = new Connection(RPC_URL, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000 
    });

    let payer;
    try {
        if (PAYER_SECRET_KEY.includes('[')) {
            payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(PAYER_SECRET_KEY)));
        } else {
            payer = Keypair.fromSecretKey(decode(PAYER_SECRET_KEY));
        }
        console.log(`✅ 发奖账户: ${payer.publicKey.toString()}`);
    } catch (e) {
        console.error('❌ 私钥格式错误:', e.message);
        process.exit(1);
    }

    // 2. 扫描持币者
    console.log('📸 正在扫描链上持币用户 (请耐心等待)...');
    try {
        const accounts = await connection.getParsedProgramAccounts(
            TOKEN_PROGRAM_ID, 
            {
                filters: [
                    { dataSize: 165 }, 
                    { memcmp: { offset: 0, bytes: OOTD_MINT_ADDRESS.toBase58() } } 
                ]
            }
        );
        
        // 过滤：余额 > 0 且 不是发奖者自己
        const holders = accounts
            .map(acc => {
                const info = acc.account.data.parsed.info;
                return {
                    owner: info.owner,
                    amount: info.tokenAmount.uiAmount
                };
            })
            .filter(h => h.amount > 0 && h.owner !== payer.publicKey.toString())
            .map(h => h.owner);

        console.log(`✅ 扫描完成！当前合格持币人数: ${holders.length}`);
        
        if (holders.length === 0) {
            console.log('⚠️ 警告：找到了 0 个持币者。请确认有人买了您的币。');
            return;
        }

        // 3. 随机抽奖
        console.log(`🎲 正在抽取 ${WINNERS_COUNT} 名幸运儿...`);
        const winners = [];
        const tempHolders = [...holders];
        
        for (let i = 0; i < Math.min(WINNERS_COUNT, tempHolders.length); i++) {
            const idx = crypto.randomInt(0, tempHolders.length);
            winners.push(tempHolders[idx]);
            tempHolders.splice(idx, 1);
        }
        console.log('🏆 中奖名单:', winners);

        // 4. 执行真实转账
        console.log('💸 正在构建真实交易...');
        
        // 获取发奖者 ATA
        let fromTokenAccount;
        try {
            fromTokenAccount = await getAssociatedTokenAddress(OOTD_MINT_ADDRESS, payer.publicKey);
        } catch (e) {
            console.error('❌ 无法找到您的代币账户，请先在钱包里买一点 OOTD 代币。');
            return;
        }
        
        const transaction = new Transaction();
        for (const winner of winners) {
            const winnerPubkey = new PublicKey(winner);
            const toTokenAccount = await getAssociatedTokenAddress(OOTD_MINT_ADDRESS, winnerPubkey);
            
            // 计算金额：1000 * 10^6
            const amountBigInt = BigInt(Math.floor(PRIZE_AMOUNT * (10 ** DECIMALS)));

            transaction.add(
                createTransferInstruction(
                    fromTokenAccount,
                    toTokenAccount,
                    payer.publicKey,
                    amountBigInt
                )
            );
        }

        console.log('⏳ 正在上链 (Sending Transaction)...');
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { skipPreflight: false, preflightCommitment: 'confirmed' }
        );
        
        console.log(`✅✅✅ 空投成功！`);
        console.log(`🔗 交易哈希: https://solscan.io/tx/${signature}`);

    } catch (e) {
        console.error('❌ 运行出错:', e.message);
        if (e.message.includes('timeout') || e.message.includes('fetch failed')) {
            console.error('🔴 网络超时：请务必开启 VPN 全局代理模式，或使用 Helius 私有节点。');
        } else if (e.message.includes('insufficient funds')) {
            console.error('🔴 余额不足：请检查 SOL (Gas) 或 OOTD 余额。');
        }
    }
}

main();