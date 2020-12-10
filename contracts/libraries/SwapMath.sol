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
        FixedPoint128.uq128x128 memory price,
        FixedPoint128.uq128x128 memory target,
        uint128 liquidity,
        int256 amountSpecifiedMax,
        uint24 feePips,
        bool zeroForOne
    )
        internal
        pure
        returns (
            FixedPoint128.uq128x128 memory priceAfter,
            uint256 amountIn,
            uint256 amountOut,
            uint256 feeAmount
        )
    {
        FixedPoint64.uq64x64 memory sqrtP = FixedPoint64.uq64x64(uint128(Babylonian.sqrt(price._x)));
        FixedPoint64.uq64x64 memory sqrtQTarget = FixedPoint64.uq64x64(uint128(Babylonian.sqrt(target._x)));

        uint256 amountInMax = amountSpecifiedMax > 0 ? uint256(amountSpecifiedMax) : 0;
        uint256 amountOutMax = amountSpecifiedMax < 0 ? uint256(-amountSpecifiedMax) : 0;

        FixedPoint64.uq64x64 memory sqrtQ;
        if (amountInMax > 0) {
            uint256 amountInMaxLessFee = FullMath.mulDiv(amountInMax, 1e6 - feePips, 1e6);
            sqrtQ = SqrtPriceMath.getNextPriceFromInput(sqrtP, liquidity, amountInMaxLessFee, zeroForOne);
        } else {
            sqrtQ = SqrtPriceMath.getNextPriceFromOutput(sqrtP, liquidity, amountOutMax, zeroForOne);
        }

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

        if (amountInMax > 0) {
            // a max input amount was specified, ensure the calculated input amount is < it
            assert(amountIn < amountInMax);
        } else {
            // a max output amount was specified, cap
            if (amountOut > amountOutMax) amountOut = amountOutMax;
        }

        if (sqrtQ._x != sqrtQTarget._x) {
            priceAfter = FixedPoint128.uq128x128(uint256(sqrtQ._x)**2);
            if (amountInMax > 0) {
                // ensure that we can pay for the calculated input amount 
                assert(SqrtPriceMath.mulDivRoundingUp(amountIn, 1e6, 1e6 - feePips) <= amountInMax);
                // we didn't reach the target, so take the remainder of the maximum input as fee
                feeAmount = amountInMax - amountIn;
            } else {
                // an exact output amount was specified, make sure we reached it
                assert(amountOut == amountOutMax);
                feeAmount = SqrtPriceMath.mulDivRoundingUp(amountIn, feePips, 1e6 - feePips);
            }
        } else {
            priceAfter = target;
            feeAmount = SqrtPriceMath.mulDivRoundingUp(amountIn, feePips, 1e6 - feePips);
            if (amountInMax > 0) assert(amountIn.add(feeAmount) <= amountInMax);
        }
    }
}
