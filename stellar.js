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

  console.log(`[stellar] PR #${githubId} successfully registered on-chain. Hash: ${result.hash}`);
  return result;
}

module.exports = { registerTaskOnChain };
