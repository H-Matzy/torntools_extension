"use strict";

(async () => {
	// if (!getPageStatus().access) return;

	const feature = featureManager.registerFeature(
		"High-low Helper",
		"casino",
		() => settings.pages.casino.highlow,
		initialiseHelper,
		null,
		removeHelper,
		{
			storage: ["settings.pages.casino.highlow"],
		},
		null
	);

	let deck;
	let gameInitialized = false;
	
	// Initialize the deck right away but keep it hidden
	shuffleDeck();
	updateDeckDisplay();
	
	// Hide the deck display initially
	const container = document.querySelector(".tt-deck-display");
	if (container) {
		container.style.opacity = '0';
		container.style.transition = 'opacity 0.5s ease-in-out';
	}
	
	// Show the deck display with a fade-in after 2 seconds
	setTimeout(() => {
		if (container) {
			container.style.opacity = '1';
		}
		gameInitialized = true;
		console.log('TornTools: Showing tracker with fade-in effect');
	}, 2000); // 2 second delay before showing

	function initialiseHelper() {
		addXHRListener(({ detail: { page, xhr, json } }) => {
			if (!feature.enabled()) return;

			if (page === "page" && gameInitialized) {
				const params = new URL(xhr.responseURL).searchParams;
				const sid = params.get("sid");

				if (sid === "highlowData" && json) {
					switch (json.status) {
						case "gameStarted":
							if (json.currentGame[0].result === "Incorrect") {
								removeHelper();
							} else {
								executeStrategy(json);
							}
							break;
						case "makeChoice":
							if (json.currentGame[0].playerCardInfo) {
								const { suit, value } = getCardWorth(json.currentGame[0].playerCardInfo);

								removeCard(suit, value);
								updateDeckDisplay(); // Update display after player card removal
							}

							removeHelper();
							break;
						case "startGame":
							removeHelper();
							moveStart();
							// Don't reset deck here as it might not have been shuffled
							break;
						case "moneyTaken":
							removeHelper();
							// Game ended, but don't reset deck until we see a shuffle
							break;
						default:
							break;
					}

					if (json.DB && json.DB.deckShuffled) {
						console.log("TornTools: Deck shuffled detected, resetting display");
						shuffleDeck();
						// Also update the display to show the full deck
						updateDeckDisplay();
					}
				}
			}
		});
	}

	function executeStrategy(data) {
		const { value: dealerValue, suit: dealerSuit } = getCardWorth(data.currentGame[0].dealerCardInfo);
		// Remove the dealer's card from our tracked deck
		removeCard(dealerSuit, dealerValue);
		// Cache dealer value first so any subsequent display uses the correct reference
		window.currentDealerCard = dealerValue;

		let higher = 0;
		let lower = 0;
		for (const suit in deck) {
			for (const value of deck[suit]) {
				if (value > dealerValue) higher++;
				else if (value < dealerValue) lower++;
			}
		}

		let outcome;
		if (higher < lower) outcome = "lower";
		else if (higher > lower) outcome = "higher";
		else outcome = "50/50";

		// Cache the dealer card value so the deck display can compute inline odds
		window.currentDealerCard = dealerValue;

		const actions = document.find(".actions-wrap");
		if (settings.pages.casino.highlowMovement) {
			let action;
			if (outcome === "lower" || outcome === "higher") action = outcome;
			else if (outcome === "50/50") action = Math.random() < 0.5 ? "higher" : "lower";

			actions.dataset.outcome = action;
			document.find(".startGame").style.display = "none";
		} else {
			const element = actions.find(".tt-high-low");
			if (element) element.textContent = outcome;
			else actions.appendChild(document.newElement({ type: "span", class: "tt-high-low", text: capitalizeText(outcome) }));
		}

		// Now that state is updated (dealer value cached, deck modified, and outcome decided),
		// refresh the deck display so the inline odds match the current recommendation
		updateDeckDisplay();
	}

	function getCardWorth({ classCode, nameShort }) {
		const suit = classCode.split("-")[0];

		let value;
		if (!isNaN(nameShort)) value = parseInt(nameShort);
		else if (nameShort === "J") value = 11;
		else if (nameShort === "Q") value = 12;
		else if (nameShort === "K") value = 13;
		else if (nameShort === "A") value = 14;
		else throw `Invalid card value (${nameShort}).`;

		return { value, suit };
	}

	function updateDeckDisplay() {
		console.log("TornTools: Updating deck display");
		const container = document.querySelector(".tt-deck-display") || document.createElement("div");
		container.className = "tt-deck-display";

		// Check localStorage for saved state, default to expanded (false)
		const isCollapsed = localStorage.getItem('ttHighLowHelper_collapsed') === 'true';
		container.classList.toggle("collapsed", isCollapsed);
		container.style.display = "block";

		if (!container.parentElement) {
			// Position below the hi-lo game area (outside the game container)
			const highLowWrap = document.querySelector(".highlow-main-wrap") || document.querySelector(".casino-content") || document.querySelector(".content");
			if (highLowWrap && highLowWrap.parentElement) {
				// Insert after the game container, not inside it
				highLowWrap.parentElement.insertBefore(container, highLowWrap.nextSibling);
				console.log("TornTools: Deck display positioned after game container");
			} else if (highLowWrap) {
				// Fallback: append to game container but ensure it's at the end
				highLowWrap.parentElement.appendChild(container);
				console.log("TornTools: Deck display appended after game container");
			} else {
				console.error("TornTools: Could not find game container to position deck display");
			}
		}

		// Build header label, adding a minimal inline odds/summary when possible
		let headerLabel = "Remaining Cards";
		if (typeof window.currentDealerCard !== "undefined") {
			let h = 0, l = 0, e = 0;
			for (const s in deck) {
				for (const v of deck[s]) {
					if (v > window.currentDealerCard) h++;
					else if (v < window.currentDealerCard) l++;
					else e++;
				}
			}
			let rec = "50/50";
			let conf = "Low";
			if (h > l) {
				rec = "Higher";
				conf = h > l * 1.5 ? "High" : h > l * 1.2 ? "Med" : "Low";
			} else if (l > h) {
				rec = "Lower";
				conf = l > h * 1.5 ? "High" : l > h * 1.2 ? "Med" : "Low";
			}
			const confClass = conf.toLowerCase() === "med" ? "medium" : conf.toLowerCase();
			const equalText = e > 0 ? ` | Equal: ${e}` : '';
			headerLabel +=
				` <span class="tt-inline-meta">— <span class="tt-inline-reco">${rec}</span> ` +
				`<span class="tt-inline-count">Lower: ${l} | Higher: ${h}${equalText}</span> ` +
				`<span class="tt-inline-confidence ${confClass}">${conf} confidence</span></span>`;
		}

		let display = "<div class='tt-deck-header'>";
		display += `<span>${headerLabel}</span>`;
		display += `<span class='tt-deck-toggle' data-action='toggle'>${isCollapsed ? '[+]' : '[−]'}</span>`;
		display += "</div>";

		display += "<div class='tt-deck-content'>";
		display += "<div class='tt-suits-container'>";

		let totalCards = 0;

		for (const [suit, cards] of Object.entries(deck)) {
			const cardCount = cards.length;
			totalCards += cardCount;

			const suitSymbol = {
				hearts: "♥",
				diamonds: "♦",
				clubs: "♣",
				spades: "♠"
			}[suit];

			const suitColor = {
				hearts: "#ff0000",
				diamonds: "#ff8800",
				clubs: "#00ff00",
				spades: "#888888"
			}[suit];

			display += `
				<div class='tt-suit-group' style='color: ${suitColor}'>
					<div class='tt-suit-header'>${suitSymbol} ${capitalizeText(suit)}</div>
					<div class='tt-suit-header'>${cardCount} cards</div>
					<div class='tt-card-list'>${cards.sort((a, b) => a - b).map((card, index) => {
						let displayValue;
						if (card === 11) displayValue = "J";
						else if (card === 12) displayValue = "Q";
						else if (card === 13) displayValue = "K";
						else if (card === 14) displayValue = "A";
						else displayValue = card;
						return `<span class='tt-card' title="Card ${index + 1}">${displayValue}</span>`;
					}).join('')}</div>
				</div>`;
		}

		display += "</div>";
		display += `<div class='tt-deck-summary'>Total: ${totalCards} cards remaining</div>`;
		display += "</div>";

		container.innerHTML = display;

		// Add event listener to toggle button after HTML is generated
		const toggleButton = container.querySelector(".tt-deck-toggle");
		if (toggleButton) {
			toggleButton.addEventListener("click", toggleDeckDisplay);
			console.log("TornTools: Added click event listener to toggle button");
		} else {
			console.error("TornTools: Could not find toggle button to add event listener");
		}

		console.log(`TornTools: Deck display updated with ${totalCards} cards`);
	}

	function toggleDeckDisplay() {
		const container = document.querySelector(".tt-deck-display");
		if (!container) {
			console.error("TornTools: Deck display container not found");
			return;
		}

		const toggle = container.querySelector(".tt-deck-toggle");
		if (!toggle) {
			console.error("TornTools: Toggle button not found");
			return;
		}

		const isCollapsed = !container.classList.contains("collapsed");
		
		// Update the UI
		container.classList.toggle("collapsed", isCollapsed);
		toggle.textContent = isCollapsed ? "[+]" : "[−]";
		toggle.setAttribute("aria-expanded", String(!isCollapsed));
		
		// Save the state to localStorage
		localStorage.setItem('ttHighLowHelper_collapsed', isCollapsed);
		console.log("TornTools: Deck display", isCollapsed ? "collapsed" : "expanded");

		// Force a style recalculation
		container.offsetHeight;
	}

	// Make toggle function globally available for manual testing
	window.toggleDeckDisplay = toggleDeckDisplay;

	// Add a test function for debugging
	window.testDeckToggle = function() {
		console.log("TornTools: Manual toggle test");
		const container = document.querySelector(".tt-deck-display");
		const toggle = document.querySelector(".tt-deck-toggle");

		console.log("Container found:", !!container);
		console.log("Toggle found:", !!toggle);

		if (container && toggle) {
			console.log("Current state:", container.classList.contains("collapsed") ? "collapsed" : "expanded");
			toggleDeckDisplay();
		} else {
			console.error("Cannot test - elements not found");
		}
	};

	function moveStart() {
		if (!settings.pages.casino.highlowMovement) return;

		const actionsWrap = document.find(".actions-wrap");
		const actions = document.find(".actions");
		const startButton = document.find(".startGame");
		const lowButton = document.find(".low");
		const highButton = document.find(".high");
		const continueButton = document.find(".continue");

		actionsWrap.style.display = "block";
		actions.appendChild(startButton);
		startButton.style.display = "inline-block";
		lowButton.style.display = "none";
		highButton.style.display = "none";
		continueButton.style.display = "none";
	}

	function shuffleDeck() {
		deck = {
			hearts: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
			diamonds: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
			clubs: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
			spades: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
		};
		updateDeckDisplay();
	}

	function removeCard(suit, value) {
		deck[suit].splice(deck[suit].indexOf(value), 1);
		updateDeckDisplay();
	}

	function removeHelper() {
		const actions = document.find(".actions-wrap");

		if (actions) {
			delete actions.dataset.outcome;
			actions.find(".tt-high-low")?.remove();
		}

		// Only remove deck display if feature is being disabled
		if (!feature.enabled()) {
			const deckDisplay = document.find(".tt-deck-display");
			if (deckDisplay) {
				deckDisplay.remove();
			}
		}
	}
})();
