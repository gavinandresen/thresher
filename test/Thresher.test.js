require('chai')
  .use(require('bn-chai')(web3.utils.BN))
  .use(require('chai-as-promised'))
  .should()

const { toBN, randomHex } = require('web3-utils')
const { takeSnapshot, revertSnapshot } = require('../lib/ganacheHelper')
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

    describe('#deposit', () => {
        it('should handle 0-value deposits', async () => {
            // win one ETH, depositing zero ETH (always lose):
            let r = await thresher.deposit(oneETH, {value: zeroETH, from: sender}).should.be.fulfilled
        })
        it('should handle max-value deposits', async () => {
            let r = await thresher.deposit(oneETH, {value: oneETH, from: sender}).should.be.fulfilled
        })
        it('should throw if deposit too large', async () => {
            let v = halfETH.add(web3.utils.toBN('1'))
            const error = await thresher.deposit(halfETH, {value: v, from: sender}).should.be.rejected
            error.reason.should.be.equal('Deposit amount too large')
        })
        it('should throw if win amount zero', async () => {
            const error = await thresher.deposit(zeroETH, {value: zeroETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Win amount must be greater than zero')
        })
        it('should throw if win amount too large', async () => {
            const error = await thresher.deposit(tenETH, {value: oneETH, from: sender}).should.be.rejected
            error.reason.should.be.equal('Win amount too large')
        })
        it('should win/lose at random', async () => {
            let winCount = 0
            let loseCount = 0
            for (var i = 0; i < 34; i++) {
                let r = await thresher.deposit(oneETH, {value: halfETH, from: sender}).should.be.fulfilled
                for (var n = 0; n < r.logs.length; n++) {
                    if (r.logs[n].event == 'Win') {
                        winCount += 1
                    }
                    if (r.logs[n].event == 'Lose') {
                        loseCount += 1
                    }
                }
            }
            // 32 of the 34 deposits should have been decided at this point
            // The chances of all of them winning or losing are 2^32-- one
            // in four billion. It COULD happen...
            console.log('Win: ', winCount)
            console.log('Lose: ', loseCount)
            assert(winCount+loseCount > 0, 'no win/lose events emitted')
            assert(winCount > 0, 'no wins')
            assert(loseCount > 0, 'no losses')
        })
    })

    afterEach(async () => {
        // Revert blockchain state between tests:
        await revertSnapshot(snapshotId.result)
        // eslint-disable-next-line require-atomic-updates
        snapshotId = await takeSnapshot()
    })
})
