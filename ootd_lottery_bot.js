/**
 * OOTD 自动抽奖机器人 (支持数据同步版)
 */
require('dotenv').config();
const { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const crypto = require('crypto');
const fs = require('fs'); // 引入文件系统模块

// --- 兼容性修复 ---
const bs58 = require('bs58');
const decode = bs58.decode || (bs58.default ? bs58.default.decode : null);
if (!decode) { console.error("❌ 错误：无法加载 bs58。"); process.exit(1); }

// --- 配置区域 ---
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const OOTD_MINT_ADDRESS = new PublicKey('DY655y1CFNBo6i1ZQVpo2ViUqbGy4tba23L2ME5Apump');
const DECIMALS = 6; 
const PRIZE_AMOUNT = 1000; // 正式版: 1000
const WINNERS_COUNT = 5;   // 正式版: 5
const PAYER_SECRET_KEY = process.env.PAYER_PRIVATE_KEY;

async function main() {
    console.log(`[${new Date().toISOString()}] 🚀 OOTD 抽奖启动...`);

    if (!PAYER_SECRET_KEY) { process.exit(1); }

    const connection = new Connection(RPC_URL, { commitment: 'confirmed', confirmTransactionInitialTimeout: 60000 });
    let payer;
    try {
        if (PAYER_SECRET_KEY.includes('[')) { payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(PAYER_SECRET_KEY))); } 
        else { payer = Keypair.fromSecretKey(decode(PAYER_SECRET_KEY)); }
    } catch (e) { process.exit(1); }
    
    // ... (省略扫描持币者和抽奖的重复逻辑，为了节省篇幅，假设 holders 和 winners 已经生成) ...
    // 为确保代码完整运行，这里简写核心逻辑，实际请保留您之前的扫描代码
    
    // --- ⬇️ 这里是模拟的“扫描+抽奖”结果，实际部署请保留您之前的完整逻辑 ---
    // 在真实代码中，请把下面这段替换回真实的扫描逻辑
    const holders = [payer.publicKey.toString()]; // 占位
    const winners = []; 
    // -------------------------------------------------------------

    // 假设我们已经有了 winners 数组 (在真实运行中，这里是上面逻辑算出来的)
    // 这里为了演示数据同步，我们先用一个假数据填充，实际请接上文的 winners
    // const realWinners = winners; 
    
    // ⚠️ 警告：为了不破坏您的代码结构，请只把下面这段“保存数据”的代码，
    // 复制粘贴到您原本代码的 `console.log('✅✅✅ 空投成功！');` 后面。

    /* ========== 请把下面这段代码加到您的主函数最后 ========== 
    */
    
    // 构造要保存的数据
    const resultData = {
        updateTime: new Date().toISOString(),
        round: "Weekly Airdrop",
        winners: [
            { address: "Wait_For_Next_Round...", amount: PRIZE_AMOUNT, tx: "Pending..." } 
            // 注意：真实运行时，请把这里的假数据换成真实的 winners 循环推入
        ]
        // 实际上，为了简单起见，我们让机器人只更新时间，前端去读最新的
    };

    // 如果真的发了奖 (winners.length > 0)
    // 我们生成一个 history.json
    const historyData = {
        lastRun: new Date().toLocaleString(),
        winners: [
            // 这里填入真实的中奖者，例如：
            // { address: "Tx9...8x", amount: 1000, tx: "https://solscan.io/tx/..." }
        ]
    };

    // 写入文件
    fs.writeFileSync('lottery_history.json', JSON.stringify(historyData, null, 2));
    console.log("💾 数据已保存到 lottery_history.json");
}

main();

main();
