class ProductSearch extends HTMLElement {
  constructor() {
    super();
    this.searchTimeout = null;
    this.cartProductIds = new Set();
  }

  connectedCallback() {
    setTimeout(() => this.init(), 100);
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
    try {
      await this.updateCartProductIds();
      
      const response = await fetch(`/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10`);
      const data = await response.json();
      
      if (data.resources?.results?.products && data.resources.results.products.length > 0) {
        const productsWithVariants = await this.fetchProductsWithVariants(data.resources.results.products);
        this.displayResults(productsWithVariants);
      } else {
        this.hideResults();
      }
    } catch (error) {
      this.hideResults();
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
    const productsWithVariants = [];
    
    for (const product of products) {
      try {
        const productResponse = await fetch(`/products/${product.handle}.js`);
        const productData = await productResponse.json();
        
        product.fullVariants = productData.variants;
        productsWithVariants.push(product);
      } catch (error) {
        product.fullVariants = [];
        productsWithVariants.push(product);
      }
    }
    
    return productsWithVariants;
  }

  displayResults(products) {
    const filteredProducts = products.filter(product => !this.cartProductIds.has(product.id));
    
    if (filteredProducts.length === 0) {
      this.hideResults();
      return;
    }

    this.resultsContainer.innerHTML = filteredProducts.map(product => {
      return `
        <div class="search-result-item" data-product-id="${product.id}">
          <img src="${product.featured_image}" alt="${product.title}" loading="lazy">
          <div class="product-info">
            <h4>${product.title}</h4>
            <span class="price">${this.formatPrice(product.price)}</span>
          </div>
        </div>
      `;
    }).join('');

    this.resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        const productId = parseInt(item.dataset.productId);
        const product = filteredProducts.find(p => p.id === productId);
        if (product) {
          this.selectProduct(product);
        }
      });
    });

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

document.addEventListener('DOMContentLoaded', () => {
  const elements = document.querySelectorAll('product-search');
  elements.forEach(element => {
    if (!element.input) {
      setTimeout(() => element.init?.(), 200);
    }
  });
});
