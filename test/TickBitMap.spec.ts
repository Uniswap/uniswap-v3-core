import {ethers} from 'hardhat'
import {TickBitMapTest} from '../typechain/TickBitMapTest'
import {expect} from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'
import {MAX_TICK, MIN_TICK} from './shared/utilities'

describe.only('TickBitMap', () => {
  let tickBitMap: TickBitMapTest

  beforeEach('deploy TickBitMapTest', async () => {
    const tickBitMapTestFactory = await ethers.getContractFactory('TickBitMapTest')
    tickBitMap = (await tickBitMapTestFactory.deploy()) as TickBitMapTest
  })

  describe('#isInitialized', () => {
    it('is false at first', async () => {
      expect(await tickBitMap.isInitialized(1)).to.eq(false)
    })
    it('is flipped by #flipTick', async () => {
      await tickBitMap.flipTick(1)
      expect(await tickBitMap.isInitialized(1)).to.eq(true)
    })
    it('is flipped back by #flipTick', async () => {
      await tickBitMap.flipTick(1)
      await tickBitMap.flipTick(1)
      expect(await tickBitMap.isInitialized(1)).to.eq(false)
    })
    it('is not changed by another flip to a different tick', async () => {
      await tickBitMap.flipTick(2)
      expect(await tickBitMap.isInitialized(1)).to.eq(false)
    })
    it('is not changed by another flip to a different tick on another word', async () => {
      await tickBitMap.flipTick(1 + 256)
      expect(await tickBitMap.isInitialized(257)).to.eq(true)
      expect(await tickBitMap.isInitialized(1)).to.eq(false)
    })
    it('works for MIN_TICK', async () => {
      expect(await tickBitMap.isInitialized(MIN_TICK)).to.eq(false)
    })
    it('works for MAX_TICK', async () => {
      expect(await tickBitMap.isInitialized(MAX_TICK)).to.eq(false)
    })
    it('throws on less than MIN_TICK', async () => {
      await expect(tickBitMap.isInitialized(MIN_TICK - 1)).to.be.revertedWith(
        'TickBitMap::position: tick must be greater than or equal to MIN_TICK'
      )
    })
    it('throws on greater than MAX_TICK', async () => {
      await expect(tickBitMap.isInitialized(MAX_TICK + 1)).to.be.revertedWith(
        'TickBitMap::position: tick must be less than or equal to MAX_TICK'
      )
    })
    it('gas if tick is not initialized', async () => {
      await snapshotGasCost(tickBitMap.getGasCostOfIsInitialized(1))
    })
    it('gas if tick is initialized', async () => {
      await tickBitMap.flipTick(1)
      await snapshotGasCost(tickBitMap.getGasCostOfIsInitialized(1))
    })
  })

  describe('#flipTick', () => {
    it('flips only the specified tick', async () => {
      await tickBitMap.flipTick(-230)
      expect(await tickBitMap.isInitialized(-230)).to.eq(true)
      expect(await tickBitMap.isInitialized(-231)).to.eq(false)
      expect(await tickBitMap.isInitialized(-229)).to.eq(false)
      expect(await tickBitMap.isInitialized(-230 + 256)).to.eq(false)
      expect(await tickBitMap.isInitialized(-230 - 256)).to.eq(false)
      await tickBitMap.flipTick(-230)
      expect(await tickBitMap.isInitialized(-230)).to.eq(false)
      expect(await tickBitMap.isInitialized(-231)).to.eq(false)
      expect(await tickBitMap.isInitialized(-229)).to.eq(false)
      expect(await tickBitMap.isInitialized(-230 + 256)).to.eq(false)
      expect(await tickBitMap.isInitialized(-230 - 256)).to.eq(false)
    })

    it('reverts only itself', async () => {
      await tickBitMap.flipTick(-230)
      await tickBitMap.flipTick(-259)
      await tickBitMap.flipTick(-229)
      await tickBitMap.flipTick(500)
      await tickBitMap.flipTick(-259)
      await tickBitMap.flipTick(-229)
      await tickBitMap.flipTick(-259)

      expect(await tickBitMap.isInitialized(-259)).to.eq(true)
      expect(await tickBitMap.isInitialized(-229)).to.eq(false)
    })

    it('works for MIN_TICK', async () => {
      await tickBitMap.flipTick(MIN_TICK)
      expect(await tickBitMap.isInitialized(MIN_TICK)).to.eq(true)
    })
    it('works for MAX_TICK', async () => {
      await tickBitMap.flipTick(MAX_TICK)
      expect(await tickBitMap.isInitialized(MAX_TICK)).to.eq(true)
    })
    it('throws on less than MIN_TICK', async () => {
      await expect(tickBitMap.flipTick(MIN_TICK - 1)).to.be.revertedWith(
        'TickBitMap::position: tick must be greater than or equal to MIN_TICK'
      )
    })
    it('throws on greater than MAX_TICK', async () => {
      await expect(tickBitMap.flipTick(MAX_TICK + 1)).to.be.revertedWith(
        'TickBitMap::position: tick must be less than or equal to MAX_TICK'
      )
    })

    it('gas cost of flipping first tick in word to initialized', async () => {
      await snapshotGasCost(await tickBitMap.getGasCostOfFlipTick(1))
    })
    it('gas cost of flipping second tick in word to initialized', async () => {
      await tickBitMap.flipTick(0)
      await snapshotGasCost(await tickBitMap.getGasCostOfFlipTick(1))
    })
    it('gas cost of flipping a tick that results in deleting a word', async () => {
      await tickBitMap.flipTick(0)
      await snapshotGasCost(await tickBitMap.getGasCostOfFlipTick(0))
    })
  })

  describe('#nextInitializedTickInSameWord', () => {
    beforeEach('set up some ticks', async () => {
      // 73 is the first positive tick at the start of a word
      await tickBitMap.flipTick(70)
      await tickBitMap.flipTick(78)
      await tickBitMap.flipTick(84)
      await tickBitMap.flipTick(139)
      await tickBitMap.flipTick(240)
    })

    describe('lte = true', () => {
      it('returns same tick if initialized', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(78, true)

        expect(next).to.eq(78)
        expect(initialized).to.eq(true)
      })
      it('returns tick directly to the left of input tick if not initialized', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(79, true)

        expect(next).to.eq(78)
        expect(initialized).to.eq(true)
      })
      it('will not exceed the word boundary', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(73, true)

        expect(next).to.eq(73)
        expect(initialized).to.eq(false)
      })
      it('at the word boundary', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(73, true)

        expect(next).to.eq(73)
        expect(initialized).to.eq(false)
      })
      it('word boundary less 1 (next initialized tick in next word)', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(72, true)

        expect(next).to.eq(70)
        expect(initialized).to.eq(true)
      })
      it('word boundary', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(69, true)

        expect(next).to.eq(-183)
        expect(initialized).to.eq(false)
      })
      it('entire empty word', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(584, true)

        expect(next).to.eq(329)
        expect(initialized).to.eq(false)
      })
      it('halfway through empty word', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(456, true)

        expect(next).to.eq(329)
        expect(initialized).to.eq(false)
      })
      it('boundary is initialized', async () => {
        await tickBitMap.flipTick(329)
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(456, true)

        expect(next).to.eq(329)
        expect(initialized).to.eq(true)
      })

      it('gas cost on boundary', async () => {
        await snapshotGasCost(await tickBitMap.getGasCostOfNextInitializedTickInSameWord(78, true))
      })
      it('gas cost just below boundary', async () => {
        await snapshotGasCost(await tickBitMap.getGasCostOfNextInitializedTickInSameWord(77, true))
      })
      it('gas cost for entire word', async () => {
        await snapshotGasCost(await tickBitMap.getGasCostOfNextInitializedTickInSameWord(584, true))
      })
    })

    describe('lte = false', async () => {
      it('returns tick to right if at initialized tick', async () => {
        const {next, initialized} = await tickBitMap.nextInitializedTickInSameWord(78, false)
        expect(next).to.eq(84)
        expect(initialized).to.eq(true)
      })
    })
  })
})
