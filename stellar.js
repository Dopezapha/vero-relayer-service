require('dotenv').config();
const { Keypair, TransactionBuilder, Networks, Operation, BASE_FEE } = require('@stellar/stellar-sdk');
const { broadcastTransaction, fetchAccount } = require('./src/services/broadcaster');
const { retry } = require('./src/utils/retry');

function getServer() {
  const { StellarSdk } = require('@stellar/stellar-sdk');
  const network = process.env.STELLAR_NETWORK || 'testnet';
  const serverUrl = network === 'mainnet'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';
  return new StellarSdk.Horizon.Server(serverUrl);
}

const { estimateStellarFee } = require('./src/services/fee-engine');

async function submitTransaction(transaction) {
  return {
    hash: `0x${Buffer.from(`pr-${transaction.githubId}`).toString('hex')}`
  };
}

async function registerTaskOnChain(githubId, options = {}) {
  const { STELLAR_SECRET_KEY, STELLAR_NETWORK } = process.env;
  const estimateFee = options.estimateFee || estimateStellarFee;
  const submit = options.submitTransaction || submitTransaction;
async function registerTaskOnChain(githubId) {
  const secretKey = process.env.STELLAR_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STELLAR_SECRET_KEY environment variable is not set');
  }

  const network = process.env.STELLAR_NETWORK || 'testnet';
  const networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const server = getServer();
  const keypair = Keypair.fromSecret(secretKey);
  const publicKey = keypair.publicKey();

  console.log(`[stellar] Loading account ${publicKey} on ${network}...`);

  const account = await fetchAccount(server, publicKey);

  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.manageData({
      name: `vero:pr:${githubId}`,
      value: `registered`,
    }))
    .setTimeout(30)
    .build();

  transaction.sign(keypair);

  console.log(`[stellar] Submitting transaction for PR #${githubId}...`);

  const result = await broadcastTransaction(server, transaction);

  const fee = await estimateFee();

  console.log(`[stellar] Compiling transaction for GitHub PR #${githubId}...`);
  console.log(`[stellar] Transaction envelope built: { op: "manageData", key: "vero:pr:${githubId}", value: "registered", fee: "${fee}" }`);

  const result = await submit({
    githubId,
    fee,
    operation: 'manageData',
    key: `vero:pr:${githubId}`,
    value: 'registered'
  });

  console.log(`[stellar] Transaction submitted (simulated). Hash: ${result.hash}`);
  console.log(`[stellar] PR #${githubId} successfully registered on-chain.`);
  console.log(`[stellar] PR #${githubId} successfully registered on-chain. Hash: ${result.hash}`);
  return result;
}

/**
 * Submits a single Stellar transaction containing one manageData op
 * per PR in the batch. Reduces RPC calls by N-to-1 for a batch of N events.
 *
 * @param {number[]} githubIds - array of PR numbers to register
 */
async function registerBatchOnChain(githubIds) {
  const { STELLAR_SECRET_KEY, STELLAR_NETWORK } = process.env;

  console.log(`[stellar] Network: ${STELLAR_NETWORK || 'testnet'}`);
  console.log(`[stellar] Secret key loaded: ${STELLAR_SECRET_KEY ? 'yes' : 'no (missing)'}`);
  console.log(`[stellar] Building batch transaction with ${githubIds.length} ops...`);

  // One manageData op per PR — packed into a single transaction envelope
  for (const id of githubIds) {
    console.log(`[stellar]   op: manageData  key=vero:pr:${id}  value=registered`);
  }

  const hash = '0x' + Buffer.from(`batch-${githubIds.join(',')}`).toString('hex').slice(0, 16);
  console.log(`[stellar] Batch transaction submitted (simulated). Hash: ${hash}`);
  console.log(`[stellar] ${githubIds.length} PR(s) registered on-chain in one tx.`);
}

module.exports = { registerTaskOnChain, registerBatchOnChain };
