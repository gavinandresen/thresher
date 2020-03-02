require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { toBN, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot, mineBlock } = require('../lib/ganacheHelper')
const Thresher = artifacts.require('./Thresher.sol')
const GasGuzzler = artifacts.require('./GasGuzzler.sol')

contract('Thresher', accounts => {
    let thresher
    let gasGuzzler
    let sender = accounts[1]
    let snapshotId

    let zeroETH = web3.utils.toBN(web3.utils.toWei('0', 'ether'))
    let eighthETH = web3.utils.toBN(web3.utils.toWei('0.125', 'ether'))
    let quarterETH = web3.utils.toBN(web3.utils.toWei('0.25', 'ether'))
    let tenETH = web3.utils.toBN(web3.utils.toWei('10', 'ether'))

    before(async () => {
        thresher = await Thresher.deployed()
        gasGuzzler = await GasGuzzler.deployed()

        snapshotId = await takeSnapshot() 
    })

    describe('#contribute', () => {
        it('should handle 0-value deposits', async () => {
            await thresher.increaseBalance({value: quarterETH}).should.be.fulfilled
            // win one ETH, depositing zero ETH (always lose):
            let r = await thresher.contribute(quarterETH, {value: zeroETH, from: sender}).should.be.fulfilled
        })
        it('should handle max-value deposits', async () => {
            let r = await thresher.contribute(quarterETH, {value: quarterETH, from: sender}).should.be.fulfilled
        })
        it('should throw if contract balance is too low to pay out', async () => {
            let v = eighthETH.add(web3.utils.toBN('1'))
            let error = await thresher.contribute(v, {value: eighthETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Balance too low')
            error = await thresher.contribute(v, {value: zeroETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Balance too low')
        })
        it('should throw if deposit too large', async () => {
            let v = eighthETH.add(web3.utils.toBN('1'));
            const error = await thresher.contribute(eighthETH, {value: v, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Amount too large');
        })
        it('should throw if win amount zero', async () => {
            const error = await thresher.contribute(zeroETH, {value: zeroETH, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Win amount must be greater than zero');
        })
        it('should throw if win amount too large', async () => {
            const error = await thresher.contribute(tenETH, {value: quarterETH, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Win amount too large');
        })
        it('should win/lose at random', async () => {
            let winCount = 0;
            let loseCount = 0;
            // Pre-fund with 10 eth so wins never wait to payout:
            await thresher.increaseBalance({value: tenETH}).should.be.fulfilled
            for (var i = 0; i < 32; i++) { // 32 deposits...
                let r = await thresher.contribute(quarterETH, {value: eighthETH, from: sender}).should.be.fulfilled;
                for (var n = 0; n < r.logs.length; n++) {
                    if (r.logs[n].event == 'Win') {
                        winCount += 1;
                    }
                    if (r.logs[n].event == 'Lose') {
                        loseCount += 1;
                    }
                }
            }
            // Last two contribute transactions will be undecided until two blocks are mined:
            await mineBlock()
            await mineBlock()
            for (var i = 0; i < 2; i++) {
                let r = await thresher.processAll().should.be.fulfilled
                for (var n = 0; n < r.logs.length; n++) {
                    if (r.logs[n].event == 'Win') {
                        winCount += 1;
                    }
                    if (r.logs[n].event == 'Lose') {
                        loseCount += 1;
                    }
                }
            }
            // The chances of all 32 winning or losing are 2^32-- one
            // in four billion. It COULD happen...
            console.log('Win: ', winCount);
            console.log('Lose: ', loseCount);
            assert(winCount+loseCount == 32, 'Missing win/lose events');
            assert(winCount > 0, 'no wins');
            assert(loseCount > 0, 'no losses');
        })
        it('Old entries should always lose', async () => {
            let winCount = 0;
            let loseCount = 0;

            thresher.contribute(quarterETH, {value: quarterETH, from: sender}).should.be.fulfilled;
            await thresher.contribute(quarterETH, {value: quarterETH, from: sender}).should.be.fulfilled;

            // Mine 256 blocks...
            for (var i = 0; i < 256; i++) {
                await mineBlock();
            }
            let r = await thresher.processAll().should.be.fulfilled
            for (var n = 0; n < r.logs.length; n++) {
                if (r.logs[n].event == 'Win') {
                    winCount += 1;
                }
                if (r.logs[n].event == 'Lose') {
                    loseCount += 1;
                }
            }
            assert(winCount == 0, `Old entries should always lose (win == ${winCount})`);
            assert(loseCount == 2, `Old entries should always lose (lose == ${loseCount})`);
        })
        it('ProcessAll gas test', async () => {
            // Call processAll() with varying amounts of gas to make sure
            // it does the right thing:
            await thresher.increaseBalance({value: tenETH}).should.be.fulfilled

            let tryGas = 500000;
            let nTries = 0;
            while (nTries < 4) {
                let sID = await takeSnapshot();
                nTries += 1;
                // Two entries...
                thresher.contribute(eighthETH, {value: eighthETH, from: sender}).should.be.fulfilled;
                await thresher.contribute(eighthETH, {value: eighthETH, from: sender}).should.be.fulfilled;
                // ... ready to be processed:
                await mineBlock();
                await mineBlock();
                let r = await thresher.processAll({ gas: tryGas }).should.be.fulfilled
                let nProcessed = r.logs.length;
                console.log(`Processing ${r.logs.length} used ${r.receipt.gasUsed} gas`);
                tryGas = r.receipt.gasUsed+75000;

                await revertSnapshot(snapshotId.result);
                if (r.logs.length == 0) {
                    break;
                }
            }
        })
        it('GasGuzzler test', async () => {
            let winCount = 0;
            let loseCount = 0;
            let failCount = 0;
            await thresher.increaseBalance({value: tenETH}).should.be.fulfilled

            // sure-winner: should generate a TransferError
            gasGuzzler.contribute(thresher.address, eighthETH, {value: eighthETH, from: sender}).should.be.fulfilled;
            // sure-loser: should generate a Lose
            await gasGuzzler.contribute(thresher.address, eighthETH, {value: zeroETH, from: sender}).should.be.fulfilled;

            await mineBlock();
            await mineBlock();

            let r = await thresher.processAll().should.be.fulfilled;
            for (var n = 0; n < r.logs.length; n++) {
                if (r.logs[n].event == 'Win') {
                    winCount += 1;
                }
                if (r.logs[n].event == 'Lose') {
                    loseCount += 1;
                }
                if (r.logs[n].event == 'TransferError') {
                    failCount += 1;
                }
            }
            assert(failCount == 1, `Gas guzzler should always lose (fail == ${failCount})`);
            assert(loseCount == 1, `Gas guzzler should always lose (lose == ${loseCount})`);
            assert(winCount == 0, `Gas guzzler should always lose (win == ${winCount})`);
        })
    })

    afterEach(async () => {
        // Revert blockchain state between tests:
        await revertSnapshot(snapshotId.result);
        // eslint-disable-next-line require-atomic-updates
        snapshotId = await takeSnapshot();
    })
})
