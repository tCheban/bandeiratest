class ProductSearch extends HTMLElement {
  constructor() {
    super();
    this.searchTimeout = null;
    this.cartProductIds = new Set();
    this.cache = new Map();
    this.lastQuery = '';
    this.abortController = null;
    this.cartUpdateListener = null;
  }

  connectedCallback() {
    this.init();
    this.setupCartListener();
    this.setupDrawerListener();
  }

  disconnectedCallback() {
    if (this.cartUpdateListener) {
      this.cartUpdateListener();
    }
  }

  init() {
    this.input = this.querySelector('input[type="search"]');
    this.resultsContainer = this.querySelector('.search-results');
    
    if (!this.input || !this.resultsContainer) return;
    
    this.input.addEventListener('input', this.handleInput.bind(this));
    document.addEventListener('click', this.handleClickOutside.bind(this));
  }

  setupCartListener() {
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      this.cartUpdateListener = subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
        setTimeout(() => {
          this.cache.clear();
          this.updateCartProductIds().then(() => {
            if (this.resultsContainer.style.display === 'block' && this.lastQuery) {
              this.displayCachedResults();
            }
          });
        }, 100);
      });
    }
  }

  displayCachedResults() {
    if (this.cache.has(this.lastQuery)) {
      this.displayResults(this.cache.get(this.lastQuery));
    }
  }

  setupDrawerListener() {
    const cartDrawer = document.querySelector('cart-drawer');
    if (cartDrawer) {
      const observer = new MutationObserver(() => {
        this.cache.clear();
        this.updateCartProductIds().then(() => {
          if (this.resultsContainer.style.display === 'block' && this.lastQuery) {
            this.displayCachedResults();
          }
        });
      });
      
      observer.observe(cartDrawer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  handleInput(e) {
    const query = e.target.value.trim();
    clearTimeout(this.searchTimeout);
    
    if (query.length < 3) {
      this.hideResults();
      return;
    }
    
    if (query === this.lastQuery) return;
    
    if (this.cache.has(query)) {
      this.displayResults(this.cache.get(query));
      return;
    }
    
    this.showLoader();
    this.searchTimeout = setTimeout(() => {
      this.searchProducts(query);
    }, 100);
  }

  handleClickOutside(e) {
    if (!this.contains(e.target)) {
      this.hideResults();
    }
  }

  async searchProducts(query) {
    this.lastQuery = query;
    
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    
    try {
      const [cartData, searchData] = await Promise.all([
        this.updateCartProductIds(),
        fetch(`/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`, {
          signal: this.abortController.signal
        }).then(r => r.json())
      ]);
      
      if (searchData.resources?.results?.products && searchData.resources.results.products.length > 0) {
        const productsWithVariants = await this.fetchProductsWithVariants(searchData.resources.results.products);
        this.cache.set(query, productsWithVariants);
        if (this.cache.size > 10) {
          const firstKey = this.cache.keys().next().value;
          this.cache.delete(firstKey);
        }
        this.displayResults(productsWithVariants);
      } else {
        this.hideResults();
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.hideResults();
      }
    }
  }

  async updateCartProductIds() {
    try {
      const response = await fetch('/cart.js?' + Date.now());
      const cart = await response.json();
      
      const newCartProductIds = new Set();
      if (cart.items && cart.items.length > 0) {
        cart.items.forEach(item => {
          newCartProductIds.add(item.product_id);
        });
      }
      
      this.cartProductIds = newCartProductIds;
      return cart;
    } catch (error) {
      this.cartProductIds = new Set();
      return null;
    }
  }

  async fetchProductsWithVariants(products) {
    const promises = products.map(async product => {
      try {
        const productResponse = await fetch(`/products/${product.handle}.js`);
        const productData = await productResponse.json();
        product.fullVariants = productData.variants;
        return product;
      } catch (error) {
        product.fullVariants = [];
        return product;
      }
    });
    
    return Promise.all(promises);
  }

  displayResults(products) {
    const filteredProducts = products.filter(product => !this.cartProductIds.has(product.id));
    
    if (filteredProducts.length === 0) {
      this.hideResults();
      return;
    }

    const fragment = document.createDocumentFragment();
    
    filteredProducts.forEach(product => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.dataset.productId = product.id;
      item.innerHTML = `
        <div class="product-info">
          <h4>${product.title}</h4>
          <span class="price">${this.formatPrice(product.price)}</span>
        </div>
      `;
      
      item.addEventListener('click', () => this.selectProduct(product), { once: true });
      fragment.appendChild(item);
    });

    this.resultsContainer.innerHTML = '';
    this.resultsContainer.appendChild(fragment);
    this.showResults();
  }

  selectProduct(product) {
    this.hideResults();
    this.input.value = '';
    
    const hasMultipleVariants = product.fullVariants && product.fullVariants.length > 1;
    
    if (hasMultipleVariants) {
      window.location.href = `/products/${product.handle}`;
    } else {
      this.addToCart(product);
    }
  }

  selectVariant(product, variantId) {
    this.hideResults();
    this.input.value = '';

    this.addToCartByVariantId(product, variantId);
  }

  async addToCart(product) {
    try {
      const productResponse = await fetch(`/products/${product.handle}.js`);
      
      if (!productResponse.ok) {
        throw new Error(`Failed to fetch product data: ${productResponse.status}`);
      }
      
      const freshProductData = await productResponse.json();
      
      const availableVariant = freshProductData.variants.find(variant => variant.available);
      
      if (!availableVariant) {
        throw new Error('No available variants found');
      }
      
      const variantId = availableVariant.id;
      
      const config = fetchConfig('javascript');
      config.headers['X-Requested-With'] = 'XMLHttpRequest';
      delete config.headers['Content-Type'];
      
      const formData = new FormData();
      formData.append('id', variantId.toString());
      formData.append('quantity', '1');
      
      const cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
      if (cart) {
        if (cart.getSectionsToRender) {
          try {
            const sections = cart.getSectionsToRender();
            if (sections && sections.length > 0) {
              formData.append(
                'sections',
                sections.map((section) => section.id)
              );
              formData.append('sections_url', window.location.pathname);
            }
          } catch (error) {
            formData.append('sections', 'cart-drawer');
            formData.append('sections_url', window.location.pathname);
          }
        }
        if (cart.setActiveElement) {
          cart.setActiveElement(this.input);
        }
      }
      config.body = formData;

      const response = await fetch(`${routes.cart_add_url}`, config);
      const responseData = await response.json();

      if (responseData.status) {
        publish(PUB_SUB_EVENTS.cartError, {
          source: 'product-search',
          productVariantId: variantId,
          errors: responseData.errors || responseData.description,
          message: responseData.message,
        });
        this.showMessage(responseData.description || 'Failed to add product to cart', 'error');
        return;
      } else if (!cart) {
        window.location = window.routes.cart_url;
        return;
      }

      this.cartProductIds.add(product.id);
      
      if (cart && cart.classList.contains('is-empty')) {
        cart.classList.remove('is-empty');
      }
      
      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, {
          source: 'product-search',
          productVariantId: variantId,
          cartData: responseData,
        });
      }
      
      if (cart && cart.renderContents) {
        cart.renderContents(responseData);
      } else if (cart && typeof cart.open === 'function') {
        cart.open();
      }
      
    } catch (error) {
      this.showMessage('Failed to add product to cart', 'error');
    }
  }

  async addToCartByVariantId(product, variantId) {
    try {
      const formData = new FormData();
      formData.append('id', variantId.toString());
      formData.append('quantity', '1');
      
      const cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
      if (cart && cart.getSectionsToRender) {
        formData.append(
          'sections',
          cart.getSectionsToRender().map((section) => section.id).join(',')
        );
        formData.append('sections_url', window.location.pathname);
      }

      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
      });

      if (response.ok) {
        const responseData = await response.json();
        
        this.cartProductIds.add(product.id);
        
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          publish(PUB_SUB_EVENTS.cartUpdate, {
            source: 'product-search',
            productVariantId: variantId,
            cartData: responseData,
          });
        }
        
      } else {
        const errorText = await response.text();
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: 'Failed to add variant to cart' };
        }
        
        this.showMessage(errorData.description || errorData.message || 'Failed to add variant to cart', 'error');
      }
      
    } catch (error) {
      this.showMessage('Failed to add variant to cart', 'error');
    }
  }

  showMessage(message, type = 'info') { 
    const notification = document.createElement('div');
    notification.className = `product-search-notification ${type}`;
    notification.textContent = message;
    
    let backgroundColor = '#2196f3';
    if (type === 'success') backgroundColor = '#2e7d32';
    if (type === 'error') backgroundColor = '#d32f2f';
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      background-color: ${backgroundColor};
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  formatPrice(price) {
    if (!price && price !== 0) return '';
    
    let priceValue = price;
    if (typeof price === 'string') {
      priceValue = parseFloat(price);
    }
    
    if (isNaN(priceValue)) return '';
    
    let currency = 'USD';
    let moneyFormat = '${{amount}}';
    
    if (window.shop?.currency) {
      currency = window.shop.currency;
    }
    
    if (window.shop?.moneyFormat) {
      moneyFormat = window.shop.moneyFormat;
    }
    
    if (typeof Shopify !== 'undefined' && Shopify.formatMoney) {
      return Shopify.formatMoney(priceValue, moneyFormat);
    }
    
    let displayPrice = priceValue;
    
    if (priceValue > 999 && priceValue % 100 === 0) {
      displayPrice = priceValue / 100;
    }
    
    const locale = document.documentElement.lang || 'en-US';
    
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(displayPrice);
    } catch (error) {
      return `${currency} ${displayPrice.toFixed(2)}`;
    }
  }

  showResults() {
    this.resultsContainer.style.display = 'block';
  }

  hideResults() {
    this.resultsContainer.style.display = 'none';
  }

  showLoader() {
    this.resultsContainer.innerHTML = `
      <div class="search-loader">
        <div class="loader-spinner"></div>
        <span>Searching...</span>
      </div>
    `;
    this.showResults();
  }
}

customElements.define('product-search', ProductSearch);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('product-search:not([data-initialized])').forEach(element => {
      element.setAttribute('data-initialized', 'true');
    });
  });
}
