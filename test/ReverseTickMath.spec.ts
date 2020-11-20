import {ethers} from 'hardhat'
import {ReverseTickMathTest} from '../typechain/ReverseTickMathTest'

import {expect} from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'
import {encodePrice} from './shared/utilities'

describe('ReverseTickMath', () => {
  let reverseTickMath: ReverseTickMathTest
  before('deploy test contract', async () => {
    const reverseTickMathTest = await ethers.getContractFactory('ReverseTickMathTest')
    reverseTickMath = (await reverseTickMathTest.deploy()) as ReverseTickMathTest
  })

  describe.only('#getTickFromPrice', () => {
    it('lowerBound = upperBound - 1', async () => {
      expect(await reverseTickMath.getTickFromPrice({_x: encodePrice(1, 1)}, 0, 1)).to.eq(0)
    })
    it('lowerBound = upperBound - 4', async () => {
      expect(await reverseTickMath.getTickFromPrice({_x: encodePrice(1, 1)}, -3, 1)).to.eq(0)
    })
    it('upperBound = lowerBound + 4', async () => {
      expect(await reverseTickMath.getTickFromPrice({_x: encodePrice(1, 1)}, 0, 4)).to.eq(0)
    })
    it('lowerBound and upper bound are both off', async () => {
      expect(await reverseTickMath.getTickFromPrice({_x: encodePrice(1, 1)}, -3, 4)).to.eq(0)
    })
    it('lowerBound == upperBound', async () => {
      await expect(reverseTickMath.getTickFromPrice({_x: encodePrice(1, 1)}, 0, 0)).to.be.revertedWith(
        'ReverseTickMath::getTickFromPrice: lower bound must be less than upper bound'
      )
    })
    it('gas cost 0 iterations', async () => {
      await snapshotGasCost(reverseTickMath.getGasCostOfGetTickFromPrice({_x: encodePrice(1, 1)}, 0, 1))
    })
    it('gas cost diff of 8', async () => {
      await snapshotGasCost(reverseTickMath.getGasCostOfGetTickFromPrice({_x: encodePrice(1, 1)}, -4, 4))
    })
    it('gas cost diff of 256', async () => {
      await snapshotGasCost(reverseTickMath.getGasCostOfGetTickFromPrice({_x: encodePrice(1, 1)}, -128, 128))
    })
  })
})
