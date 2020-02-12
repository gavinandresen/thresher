#!/usr/bin/env node

/*
 * Utility that subscribes to Thresher contract events on the chain
 * and calls processAll() if a bunch of blocks go by with entries
 * waiting to win/lose.
 *
 */
/*
 * Before running, create a .env configuration file; for example:

BLOCKS_TO_WAIT=3
WEB3_EVENT_PROVIDER=ws://localhost:9545
WALLET_PRIVATE_KEY=348ce564d4.....
TRACE=1

 * ... and send some ETH to the address corresponding to WALLET_PRIVATE_KEY
 */

const assert = require('assert');
const Web3 = require('web3');
const PrivateKeyProvider = require("truffle-privatekey-provider");
const { toWei, fromWei } = require('web3-utils');

let web3;
let accounts;
let thresher;

let entriesWaiting = 0;
let lastContributeBlock = 0;

require('dotenv').config();

function addEntry(event) {
    entriesWaiting = entriesWaiting + 1;
    lastContributeBlock = event.blockNumber;
}
function removeEntry(event) {
    entriesWaiting = entriesWaiting - 1;
    if (entriesWaiting < 0) {
        console.log("ERROR: Entries waiting : "+entriesWaiting);
        entriesWaiting = 0;
    }
}

async function init() {
    if (process.env.WALLET_PRIVATE_KEY === undefined) {
        console.log("You must give a WALLET_PRIVATE_KEY=a955... in the .env file");
        process.exit(1);
    }

    web3 = new Web3()
    const eventProvider = new Web3.providers.WebsocketProvider(process.env.WEB3_EVENT_PROVIDER);
    web3.setProvider(eventProvider)

    const account = web3.eth.accounts.privateKeyToAccount('0x' + process.env.WALLET_PRIVATE_KEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    console.log(`Sending transcations (paying gas) from ${web3.eth.defaultAccount}`);

    let contractJson = require('./build/contracts/Thresher.json');

    let netId = await web3.eth.net.getId();
    if (contractJson.networks[netId]) {
        const tx = await web3.eth.getTransaction(contractJson.networks[netId].transactionHash);
        thresher = new web3.eth.Contract(contractJson.abi, contractJson.networks[netId].address);
        thresher.deployedBlock = tx.blockNumber;
        thresher.options.from = account.address;
    } else {
        console.log("Don't know where the contract is deployed on this network");
        process.exit(1);
    }

    thresher.events.Contribute({
        fromBlock: thresher.deployedBlock
    })
    .on('data', addEntry)
    .on('changed', removeEntry)

    thresher.events.Win({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
    thresher.events.Lose({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
    thresher.events.TransferError({
        fromBlock: thresher.deployedBlock
    })
    .on('data', removeEntry)
    .on('changed', addEntry)
}

async function processAll() {
    if (entriesWaiting == 0) {
        return;
    }
    let currentBlock = await web3.eth.getBlockNumber();

    let blockGap = currentBlock-lastContributeBlock;
    if (blockGap >= process.env.BLOCKS_TO_WAIT) {
        if (process.env.TRACE) {
            console.log(`${entriesWaiting } entries waited ${blockGap} blocks, calling processAll()`);
        }

        let g = await thresher.methods.processAll().estimateGas();
        await thresher.methods.processAll().send({gas: g});
    }
}

init();

let looper = setInterval(processAll, 10*1000);
looper.ref();  /* Referencing the timer makes node.js loop forever */
