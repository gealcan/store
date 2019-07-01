import PropTypes from 'prop-types'
import React, { useMemo, useReducer, useEffect } from 'react'
import { last, head, path, propEq, find } from 'ramda'
import { Helmet, useRuntime } from 'vtex.render-runtime'
import { ProductOpenGraph } from 'vtex.open-graph'
import { ProductContext as ProductContextApp } from 'vtex.product-context'
import { ProductDispatchContext } from 'vtex.product-context/ProductDispatchContext'

import StructuredData from './components/StructuredData'
import WrapperContainer from './components/WrapperContainer'

import useDataPixel from './hooks/useDataPixel'

function reducer(state, action) {
  const args = action.args || {}
  switch (action.type) {
    case 'SET_QUANTITY':
      return {
        ...state,
        selectedQuantity: args.quantity,
      }
    case 'SKU_SELECTOR_SET_VARIATIONS_SELECTED': {
      return {
        ...state,
        skuSelector: {
          ...state.skuSelector,
          areAllVariationsSelected: args.allSelected,
        },
      }
    }
    case 'SET_SELECTED_ITEM_BY_ID': {
      return {
        ...state,
        selectedItem: findItemById(args.id)(state.product.items),
      }
    }
    case 'SET_SELECTED_ITEM': {
      return {
        ...state,
        selectedItem: args.item,
      }
    }
    case 'SET_PRODUCT': {
      const differentSlug =
        path(['product', 'linkText'], state) !==
        path(['product', 'linkText'], args)
      return {
        ...state,
        product: args.product,
        ...(differentSlug && {
          selectedItem: null,
          selectedQuantity: 1,
          skuSelector: {
            areAllVariationsSelected: false,
          },
        }),
      }
    }
    default:
      return state
  }
}

const findItemById = id => find(propEq('itemId', id))
function findAvailableProduct(item) {
  return item.sellers.find(
    ({ commertialOffer = {} }) => commertialOffer.AvailableQuantity > 0
  )
}

function getSelectedItem(skuId, items) {
  return skuId
    ? findItemById(skuId)(items)
    : items.find(findAvailableProduct) || items[0]
}

function useProductInState(product, dispatch) {
  useEffect(() => {
    if (product) {
      dispatch({
        type: 'SET_PRODUCT',
        args: { product },
      })
    }
  }, [product, dispatch])
}

function useSelectedItemFromId(skuId, dispatch, selectedItem, product) {
  useEffect(() => {
    const items = (product && product.items) || []
    if (!selectedItem || (skuId && selectedItem.itemId !== skuId)) {
      dispatch({
        type: 'SET_SELECTED_ITEM',
        args: { item: getSelectedItem(skuId, items) },
      })
    }
  }, [dispatch, selectedItem, skuId, product])
}

function initReducer({ query, items, product }) {
  return {
    selectedItem: getSelectedItem(query.skuId, items),
    product,
    selectedQuantity: 1,
    skuSelector: {
      areAllVariationsSelected: false,
    },
  }
}

const ProductWrapper = ({
  params: { slug },
  productQuery,
  productQuery: { product, loading } = {},
  query,
  children,
  ...props
}) => {
  const { account, getSettings } = useRuntime()
  const items = path(['items'], product) || []

  const [state, dispatch] = useReducer(
    reducer,
    { query, items, product },
    initReducer
  )

  // These hooks are used to keep the state in sync with API data, specially when switching between products without exiting the product page
  useProductInState(product, dispatch)
  useSelectedItemFromId(query.skuId, dispatch, state.selectedItem, product)

  const pixelEvents = useMemo(() => {
    const {
      titleTag,
      brand,
      categoryId,
      categoryTree,
      productId,
      productName,
      items,
    } = product || {}

    if (!product || typeof document === 'undefined') {
      return []
    }

    const pageInfo = {
      event: 'pageInfo',
      eventType: 'productView',
      accountName: account,
      pageCategory: 'Product',
      pageDepartment: categoryTree ? head(categoryTree).name : '',
      pageFacets: [],
      pageTitle: titleTag,
      pageUrl: window.location.href,
      productBrandName: brand,
      productCategoryId: Number(categoryId),
      productCategoryName: categoryTree ? last(categoryTree).name : '',
      productDepartmentId: categoryTree ? head(categoryTree).id : '',
      productDepartmentName: categoryTree ? head(categoryTree).name : '',
      productId: productId,
      productName: productName,
      skuStockOutFromProductDetail: [],
      skuStockOutFromShelf: [],
    }

    const skuId = query.skuId || (items && head(items).itemId)

    const [sku] =
      (items && items.filter(product => product.itemId === skuId)) || []

    const { ean, referenceId, sellers } = sku || {}

    pageInfo.productEans = [ean]

    if (referenceId && referenceId.length >= 0) {
      const [{ Value: refIdValue }] = referenceId

      pageInfo.productReferenceId = refIdValue
    }

    if (sellers && sellers.length >= 0) {
      const [{ commertialOffer, sellerId }] = sellers

      pageInfo.productListPriceFrom = `${commertialOffer.ListPrice}`
      pageInfo.productListPriceTo = `${commertialOffer.ListPrice}`
      pageInfo.productPriceFrom = `${commertialOffer.Price}`
      pageInfo.productPriceTo = `${commertialOffer.Price}`
      pageInfo.sellerId = `${sellerId}`
      pageInfo.sellerIds = `${sellerId}`
    }

    // Add selected SKU property to the product object
    product.selectedSku = query.skuId ? query.skuId : product.items[0].itemId

    return [
      pageInfo,
      {
        event: 'productView',
        product,
      },
    ]
  }, [account, product, query.skuId])

  useDataPixel(pixelEvents, loading)

  const { titleTag, productName, metaTagDescription } = product || {}

  let title = titleTag || productName

  try {
    const settings = getSettings('vtex.store')
    if (settings) {
      const { storeName, titleTag: storeTitleTag } = settings
      const suffix =
        (storeTitleTag || storeName) && ` - ${storeTitleTag || storeName}`
      if (suffix) {
        title += suffix
      }
    }
  } catch (e) {
    console.error('Failed to suffix store name in title.', e)
  }

  const childrenProps = useMemo(
    () => ({
      productQuery,
      slug,
      ...props,
    }),
    [productQuery, slug, props]
  )

  return (
    <WrapperContainer className="vtex-product-context-provider">
      <Helmet
        title={title}
        meta={[
          metaTagDescription && {
            name: 'description',
            content: metaTagDescription,
          },
        ].filter(Boolean)}
      />
      <ProductContextApp.Provider value={state}>
        <ProductDispatchContext.Provider value={dispatch}>
          {product && <ProductOpenGraph />}
          {product && <StructuredData product={product} query={query} />}
          {React.cloneElement(children, childrenProps)}
        </ProductDispatchContext.Provider>
      </ProductContextApp.Provider>
    </WrapperContainer>
  )
}

ProductWrapper.propTypes = {
  params: PropTypes.object,
  productQuery: PropTypes.object,
  children: PropTypes.node,
  /* URL query params */
  query: PropTypes.object,
}

export default ProductWrapper
