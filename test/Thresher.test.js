require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { toBN, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot, mineBlock } = require('../lib/ganacheHelper')
const Thresher = artifacts.require('./Thresher.sol')

contract('Thresher', accounts => {
    let thresher
    let sender = accounts[1]
    let snapshotId

    let zeroETH = web3.utils.toBN(web3.utils.toWei('0', 'ether'))
    let halfETH = web3.utils.toBN(web3.utils.toWei('0.5', 'ether'))
    let oneETH = web3.utils.toBN(web3.utils.toWei('1', 'ether'))
    let tenETH = web3.utils.toBN(web3.utils.toWei('10', 'ether'))

    before(async () => {
        thresher = await Thresher.deployed()

        snapshotId = await takeSnapshot() 
    })

    describe('#contribute', () => {
        it('should handle 0-value deposits', async () => {
            await thresher.increaseBalance({value: oneETH}).should.be.fulfilled
            // win one ETH, depositing zero ETH (always lose):
            let r = await thresher.contribute(oneETH, {value: zeroETH, from: sender}).should.be.fulfilled
        })
        it('should handle max-value deposits', async () => {
            let r = await thresher.contribute(oneETH, {value: oneETH, from: sender}).should.be.fulfilled
        })
        it('should throw if contract balance is too low to pay out', async () => {
            let v = halfETH.add(web3.utils.toBN('1'))
            let error = await thresher.contribute(v, {value: halfETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Balance too low')
            error = await thresher.contribute(v, {value: zeroETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Balance too low')
        })
        it('should throw if deposit too large', async () => {
            let v = halfETH.add(web3.utils.toBN('1'));
            const error = await thresher.contribute(halfETH, {value: v, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Amount too large');
        })
        it('should throw if win amount zero', async () => {
            const error = await thresher.contribute(zeroETH, {value: zeroETH, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Win amount must be greater than zero');
        })
        it('should throw if win amount too large', async () => {
            const error = await thresher.contribute(tenETH, {value: oneETH, from: sender}).should.be.rejected;
            error.reason.should.be.equal('Win amount too large');
        })
        it('should win/lose at random', async () => {
            let winCount = 0;
            let loseCount = 0;
            // Pre-fund with 10 eth so wins never wait to payout:
            await thresher.increaseBalance({value: tenETH}).should.be.fulfilled
            for (var i = 0; i < 32; i++) { // 32 deposits...
                let r = await thresher.contribute(oneETH, {value: halfETH, from: sender}).should.be.fulfilled;
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

            thresher.contribute(oneETH, {value: oneETH, from: sender}).should.be.fulfilled;
            await thresher.contribute(oneETH, {value: oneETH, from: sender}).should.be.fulfilled;

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
    })

    afterEach(async () => {
        // Revert blockchain state between tests:
        await revertSnapshot(snapshotId.result);
        // eslint-disable-next-line require-atomic-updates
        snapshotId = await takeSnapshot();
    })
})
