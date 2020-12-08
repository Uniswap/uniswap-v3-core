// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity >=0.5.0;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '@uniswap/lib/contracts/libraries/FullMath.sol';

import './FixedPoint64.sol';
import './FixedPoint128.sol';
import './SqrtPriceMath.sol';

library SwapMath {
    using SafeMath for uint256;

    function computeSwapStep(
        FixedPoint64.uq64x64 memory sqrtP,
        FixedPoint64.uq64x64 memory sqrtQTarget,
        uint128 liquidity,
        uint256 amountInMax,
        uint24 feePips,
        bool zeroForOne
    )
        internal
        pure
        returns (
            FixedPoint64.uq64x64 memory priceAfter,
            uint256 amountIn,
            uint256 amountOut,
            uint256 feeAmount
        )
    {
        uint256 amountInLessFee = FullMath.mulDiv(amountInMax, 1e6 - feePips, 1e6);

        FixedPoint64.uq64x64 memory sqrtQ = SqrtPriceMath.getNextPrice(sqrtP, liquidity, amountInLessFee, zeroForOne);

        // get the input/output amounts
        if (zeroForOne) {
            assert(sqrtP._x >= sqrtQTarget._x);

            // if we've overshot the target, cap at the target
            if (sqrtQ._x < sqrtQTarget._x) sqrtQ = sqrtQTarget;

            amountIn = SqrtPriceMath.getAmount0Delta(sqrtP, sqrtQ, liquidity, true);
            amountOut = SqrtPriceMath.getAmount1Delta(sqrtQ, sqrtP, liquidity, false);
        } else {
            assert(sqrtP._x <= sqrtQTarget._x);

            // if we've overshot the target, cap at the target
            if (sqrtQ._x > sqrtQTarget._x) sqrtQ = sqrtQTarget;

            amountIn = SqrtPriceMath.getAmount1Delta(sqrtP, sqrtQ, liquidity, true);
            amountOut = SqrtPriceMath.getAmount0Delta(sqrtQ, sqrtP, liquidity, false);
        }

        priceAfter = sqrtQ;
        // if we didn't reach the target, take the remainder of the maximum input as fee
        if (sqrtQ._x != sqrtQTarget._x) {
            assert(amountInMax >= SqrtPriceMath.mulDivRoundingUp(amountIn, 1e6, 1e6 - feePips));
            feeAmount = amountInMax - amountIn;
        } else {
            feeAmount = SqrtPriceMath.mulDivRoundingUp(amountIn, feePips, 1e6 - feePips);
            assert(amountIn.add(feeAmount) <= amountInMax);
        }
    }
}
