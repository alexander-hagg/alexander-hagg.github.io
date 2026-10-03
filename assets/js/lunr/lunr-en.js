---
layout: none
---

var idx = lunr(function () {
  this.field('title')
  this.field('excerpt')
  this.field('categories')
  this.field('tags')
  this.ref('id')

  this.pipeline.remove(lunr.trimmer)

  for (var item in store) {
    this.add({
      title: store[item].title,
      excerpt: store[item].excerpt,
      categories: store[item].categories,
      tags: store[item].tags,
      id: item
    })
  }
});

$(document).ready(function () {
  // Search overlay open/close. These handlers normally live in the theme's
  // compiled main.min.js; they are defined here so the search UI is fully
  // self-contained in the Lunr search bundle.
  $(".search__toggle").on("click", function () {
    $(".search-content").toggleClass("is--visible");
    $(".initial-content").toggleClass("is--hidden");
    setTimeout(function () {
      $(".search-content input").focus();
    }, 400);
  });

  $(document).keyup(function (e) {
    if (e.keyCode === 27 && $(".search-content").hasClass("is--visible")) {
      $(".search-content").removeClass("is--visible");
      $(".initial-content").removeClass("is--hidden");
    }
  });

  $('input#search').on('keyup', function () {
    var resultdiv = $('#results');
    var query = $(this).val().toLowerCase();
    var result =
      idx.query(function (q) {
        query.split(lunr.tokenizer.separator).forEach(function (term) {
          q.term(term, { boost: 100 })
          if (query.lastIndexOf(" ") != query.length - 1) {
            q.term(term, { usePipeline: false, wildcard: lunr.Query.wildcard.TRAILING, boost: 10 })
          }
          if (term != "") {
            q.term(term, { usePipeline: false, editDistance: 1, boost: 1 })
          }
        })
      });
    resultdiv.empty();
    resultdiv.prepend('<p class="results__found">' + result.length + ' result(s) found</p>');
    for (var item in result) {
      var ref = result[item].ref;
      if (store[ref].teaser) {
        var searchitem =
          '<div class="list__item">' +
            '<article class="archive__item" itemscope itemtype="https://schema.org/CreativeWork">' +
              '<h2 class="archive__item-title" itemprop="headline">' +
                '<a href="' + store[ref].url + '" rel="permalink">' + store[ref].title + '</a>' +
              '</h2>' +
              '<div class="archive__item-teaser">' +
                '<img src="' + store[ref].teaser + '" alt="">' +
              '</div>' +
              '<p class="archive__item-excerpt" itemprop="description">' + store[ref].excerpt.split(" ").splice(0, 20).join(" ") + '...</p>' +
            '</article>' +
          '</div>';
      }
      else {
        var searchitem =
          '<div class="list__item">' +
            '<article class="archive__item" itemscope itemtype="https://schema.org/CreativeWork">' +
              '<h2 class="archive__item-title" itemprop="headline">' +
                '<a href="' + store[ref].url + '" rel="permalink">' + store[ref].title + '</a>' +
              '</h2>' +
              '<p class="archive__item-excerpt" itemprop="description">' + store[ref].excerpt.split(" ").splice(0, 20).join(" ") + '...</p>' +
            '</article>' +
          '</div>';
      }
      resultdiv.append(searchitem);
    }
  });
});
