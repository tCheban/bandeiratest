class ProductSearch extends HTMLElement {
  constructor() {
    super();
    this.searchTimeout = null;
    this.cartProductIds = new Set();
    this.cache = new Map();
    this.lastQuery = '';
    this.abortController = null;
  }

  connectedCallback() {
    this.init();
  }

  init() {
    this.input = this.querySelector('input[type="search"]');
    this.resultsContainer = this.querySelector('.search-results');
    
    if (!this.input || !this.resultsContainer) return;
    
    this.input.addEventListener('input', this.handleInput.bind(this));
    document.addEventListener('click', this.handleClickOutside.bind(this));
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
      const response = await fetch('/cart.js');
      const cart = await response.json();
      
      this.cartProductIds = new Set();
      if (cart.items && cart.items.length > 0) {
        cart.items.forEach(item => {
          this.cartProductIds.add(item.product_id);
        });
      }
    } catch (error) {
      this.cartProductIds = new Set();
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
        <img src="${product.featured_image}" alt="${product.title}" loading="lazy">
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
        this.triggerCartUpdate(responseData, availableVariant.id);
        this.updateCartCount();
        
      } else {
        const errorText = await response.text();
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { message: 'Failed to add product to cart' };
        }
        
        this.showMessage(errorData.description || errorData.message || 'Failed to add product to cart', 'error');
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
        this.triggerCartUpdate(responseData, variantId);
        this.updateCartCount();
        
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

  triggerCartUpdate(cartData, variantId) {
    const cart = document.querySelector('cart-drawer') || document.querySelector('cart-notification');
    
    if (cart) {
      try {
        if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
          publish(PUB_SUB_EVENTS.cartUpdate, {
            source: 'product-search',
            productVariantId: variantId,
            cartData: cartData,
          });
        }
        
        if (cart.renderContents) {
          cart.renderContents(cartData);
        }
        
      } catch (error) {
        this.showMessage(`Product added to cart!`, 'success');
      }
      
    } else {
      this.showMessage(`Product added to cart!`, 'success');
    }
  }

  updateCartCount() {
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        const cartCount = document.querySelector('.cart-count-bubble span, [data-cart-count]');
        if (cartCount) {
          cartCount.textContent = cart.item_count;
        }
      })
      .catch(() => {});
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
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price / 100);
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
